import { createHash, randomUUID } from "node:crypto";
import { realpathSync, watch, type FSWatcher } from "node:fs";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Models } from "@earendil-works/pi-ai";
import {
  convertFromPiMessages,
  normalizeThread,
  type ModelConfig,
  type ProjectTool,
  type Thread,
} from "@llm-space/core";
import {
  createDefaultThreadVariables,
  ensureThreadVariableState,
} from "@llm-space/core/thread";
import {
  AgentRuntime,
  loadAgentProject,
  loadAgentProjectManifest,
  type AgentRuntimeSession,
  type CreateAgentRuntimeSessionOptions,
  type AgentProjectSnapshot,
  type ResolvedAgentDefinition,
  type ResolvedAgentProjectManifest,
} from "@llm-space/runtime/node";

import type {
  ExternalAgentProjectPreview,
  ExternalAgentProjectSummary,
  ExternalAgentProjectThreadRecord,
  ExternalAgentProjectThreadSummary,
  ExternalAgentProjectView,
} from "../../shared/external-agent-project";

interface RegistryEntry {
  path: string;
  trusted: boolean;
  origin: "workspace" | "registered";
}

interface RegistryFile {
  projects: Pick<RegistryEntry, "path" | "trusted">[];
}

interface LoadedProject {
  resolved: ResolvedAgentProjectManifest | null;
  snapshot: AgentProjectSnapshot | null;
  error: string | null;
  missing: boolean;
  watcher: FSWatcher | null;
  reloadTimer: ReturnType<typeof setTimeout> | null;
  snapshots: Map<string, AgentProjectSnapshot>;
  runtime: AgentRuntime | null;
  models: Models | null;
}

interface ThreadFile {
  thread: Thread;
  promptFingerprint: string;
  syncedPrompt: string;
  definitionFingerprint: string;
  syncedDefinition: ResolvedAgentDefinition;
}

export class ExternalAgentProjectManager {
  private readonly _settingsFile: string;
  private readonly _dataRoot: string;
  private readonly _workspaceRoot: string;
  private readonly _getModels: () => Promise<Models>;
  private readonly _registry = new Map<string, RegistryEntry>();
  private readonly _loaded = new Map<string, LoadedProject>();
  private _loadedRegistry = false;
  private _onChange: ((projectId: string) => void) | null = null;

  constructor(options: {
    homePath: string;
    workspaceRoot: string;
    getModels?: () => Promise<Models>;
  }) {
    const { homePath, workspaceRoot } = options;
    this._getModels =
      options.getModels ??
      (() =>
        Promise.resolve({ getModel: () => undefined } as unknown as Models));
    this._settingsFile = path.join(
      homePath,
      "settings",
      "external-agent-projects.json"
    );
    this._dataRoot = path.join(homePath, "projects");
    try {
      this._workspaceRoot = realpathSync(workspaceRoot);
    } catch {
      this._workspaceRoot = path.resolve(workspaceRoot);
    }
  }

  setOnChange(listener: (projectId: string) => void): void {
    this._onChange = listener;
  }

  async preview(
    projectDirectory: string
  ): Promise<ExternalAgentProjectPreview> {
    await this._ensureRegistry();
    const resolved = await loadAgentProjectManifest(projectDirectory);
    const id = _projectId(resolved.projectRoot);
    return {
      id,
      name: path.basename(resolved.projectRoot),
      path: resolved.projectRoot,
      trusted: this._registry.get(id)?.trusted === true,
    };
  }

  async trustAndOpen(
    projectDirectory: string
  ): Promise<ExternalAgentProjectView> {
    await this._ensureRegistry();
    const resolved = await loadAgentProjectManifest(projectDirectory);
    const id = _projectId(resolved.projectRoot);
    const inWorkspace = _within(this._workspaceRoot, resolved.projectRoot);
    this._registry.set(id, {
      path: resolved.projectRoot,
      trusted: true,
      origin: inWorkspace ? "workspace" : "registered",
    });
    if (!inWorkspace) await this._saveRegistry();
    await this._reload(id, { resolved });
    const view = await this.inspect(id);
    if (view.status !== "ready") return view;
    await this._ensureDefaultThread(id);
    return this.inspect(id);
  }

  async list(): Promise<ExternalAgentProjectSummary[]> {
    await this._ensureRegistry();
    return Promise.all(
      [...this._registry.keys()].map(async (id) => {
        await this._ensureProject(id);
        return this._summary(id);
      })
    );
  }

  async inspect(projectId: string): Promise<ExternalAgentProjectView> {
    await this._ensureRegistry();
    await this._ensureProject(projectId);
    const entry = this._entry(projectId);
    const loaded = this._state(projectId);
    const snapshot = loaded.snapshot;
    const threads = await this._listThreads(projectId);
    return {
      id: projectId,
      name: path.basename(entry.path),
      path: entry.path,
      removable: entry.origin === "registered",
      status: loaded.missing ? "missing" : loaded.error ? "invalid" : "ready",
      ...(loaded.error ? { error: loaded.error } : {}),
      threads,
      agentPath: loaded.resolved?.agentRoot ?? null,
      instructions: snapshot?.instructions ?? "",
      definition: snapshot?.definition ?? null,
      definitionFingerprint: snapshot?.definition
        ? _definitionFingerprint(snapshot.definition)
        : "",
      promptFingerprint: snapshot
        ? _textFingerprint(snapshot.instructions)
        : "",
      snapshot: snapshot?.fingerprint ?? "",
      tools: snapshot ? _projectTools(projectId, snapshot) : [],
      skills: snapshot
        ? (snapshot.resources.skills ?? []).map((skill) => ({
            name: skill.name,
            description: skill.description,
            path: `project:${projectId}/skills/${skill.name}`,
            enabled: true,
          }))
        : [],
      diagnostics: snapshot?.diagnostics ?? [],
      sourceFiles: loaded.resolved
        ? await _listSourceFiles(loaded.resolved.agentRoot)
        : [],
    };
  }

  async remove(projectId: string): Promise<void> {
    await this._ensureRegistry();
    if (this._entry(projectId).origin === "workspace") {
      throw new Error("Workspace Agents are discovered automatically.");
    }
    this._registry.delete(projectId);
    this._closeLoaded(projectId);
    await this._saveRegistry();
    this._notify(projectId);
  }

  async createThread(
    projectId: string,
    title = "untitled"
  ): Promise<{ id: string; record: ExternalAgentProjectThreadRecord }> {
    const view = await this.inspect(projectId);
    if (view.status !== "ready") {
      throw new Error(view.error ?? "Agent Project is invalid.");
    }
    if (!view.definition) {
      throw new Error("Agent Project has no valid definition.");
    }
    const id = randomUUID();
    const variables = createDefaultThreadVariables();
    const skillVariable = variables.available_skills;
    if (skillVariable?.type === "skills") {
      variables.available_skills = {
        ...skillVariable,
        skillNames: view.skills.map((skill) => skill.name),
      };
    }
    const thread: Thread = ensureThreadVariableState({
      title,
      model: _modelFromDefinition(view.definition),
      agentRuntime: {
        projectId,
        snapshot: view.snapshot,
        definitionFingerprint: view.definitionFingerprint,
        modelSource: "agent",
      },
      context: {
        systemPrompt: view.instructions,
        messages: [],
        tools: view.tools,
        variables,
      },
    });
    const record = {
      thread,
      promptFingerprint: view.promptFingerprint,
      syncedPrompt: view.instructions,
      definitionFingerprint: view.definitionFingerprint,
      syncedDefinition: view.definition,
    };
    await this._writeThreadFile(projectId, id, record);
    this._notify(projectId);
    return { id, record };
  }

  async readThread(
    projectId: string,
    threadId: string
  ): Promise<ExternalAgentProjectThreadRecord> {
    const loaded = await this.inspect(projectId);
    const stored = await this._readThreadFile(projectId, threadId);
    return {
      promptFingerprint: stored.promptFingerprint,
      syncedPrompt: stored.syncedPrompt,
      definitionFingerprint: stored.definitionFingerprint,
      syncedDefinition: stored.syncedDefinition,
      thread: _reconcileThread(stored.thread, loaded),
    };
  }

  async writeThread(
    projectId: string,
    threadId: string,
    record: ExternalAgentProjectThreadRecord
  ): Promise<void> {
    this._entry(projectId);
    await this._writeThreadFile(projectId, threadId, {
      thread: normalizeThread(record.thread),
      promptFingerprint: record.promptFingerprint,
      syncedPrompt: record.syncedPrompt,
      definitionFingerprint: record.definitionFingerprint,
      syncedDefinition: record.syncedDefinition,
    });
    this._notify(projectId);
  }

  async duplicateThread(
    projectId: string,
    threadId: string
  ): Promise<{ id: string; record: ExternalAgentProjectThreadRecord }> {
    const source = await this.readThread(projectId, threadId);
    const id = randomUUID();
    const record = {
      ...source,
      thread: {
        ...source.thread,
        title: `${source.thread.title ?? "untitled"} copy`,
      },
    };
    await this._writeThreadFile(projectId, id, record);
    this._notify(projectId);
    return { id, record };
  }

  async deleteThread(projectId: string, threadId: string): Promise<void> {
    await rm(this._threadFile(projectId, threadId), { force: true });
    this._notify(projectId);
  }

  async syncThreadFromAgent(
    projectId: string,
    threadId: string
  ): Promise<ExternalAgentProjectThreadRecord> {
    const project = await this.inspect(projectId);
    const record = await this.readThread(projectId, threadId);
    if (!project.definition) {
      throw new Error("Agent Project has no valid definition.");
    }
    const next = {
      promptFingerprint: project.promptFingerprint,
      syncedPrompt: project.instructions,
      definitionFingerprint: project.definitionFingerprint,
      syncedDefinition: project.definition,
      thread: {
        ...record.thread,
        model: _modelFromDefinition(project.definition, record.thread.model),
        agentRuntime: {
          projectId,
          snapshot: project.snapshot,
          definitionFingerprint: project.definitionFingerprint,
          modelSource: "agent" as const,
        },
        context: {
          ...record.thread.context,
          systemPrompt: project.instructions,
        },
      },
    };
    await this.writeThread(projectId, threadId, next);
    return next;
  }

  async readSource(projectId: string, relativePath: string): Promise<string> {
    const root = await this._agentRoot(projectId);
    return readFile(await _safeExistingSource(root, relativePath), "utf8");
  }

  async writeSource(
    projectId: string,
    relativePath: string,
    text: string
  ): Promise<void> {
    const root = await this._agentRoot(projectId);
    const target = await _safeExistingSource(root, relativePath);
    await writeFile(target, text, "utf8");
  }

  async callTool(input: {
    projectId: string;
    snapshot: string;
    name: string;
    arguments: Record<string, unknown>;
  }): Promise<{ contentText: string; isError: boolean }> {
    await this._ensureProject(input.projectId);
    const loaded = this._state(input.projectId);
    const snapshot = loaded.snapshots.get(input.snapshot);
    if (!snapshot) {
      throw new Error(
        "This Agent Project snapshot is no longer available. Refresh the Thread and run again."
      );
    }
    const tool = snapshot.tools.find(
      (candidate) => candidate.name === input.name
    );
    if (!tool) {
      throw new Error(`Project tool not found: ${input.name}`);
    }
    const result = await tool.execute(randomUUID(), input.arguments);
    const text = result.content
      .filter((item) => item.type === "text")
      .map((item) => item.text)
      .join("\n");
    return { contentText: text, isError: false };
  }

  async createRuntimeSession(
    projectId: string,
    options: CreateAgentRuntimeSessionOptions
  ): Promise<AgentRuntimeSession> {
    await this._ensureProject(projectId);
    const loaded = this._state(projectId);
    if (loaded.error || !loaded.runtime) {
      throw new Error(loaded.error ?? "Agent runtime is unavailable.");
    }
    const models = await this._getModels();
    if (models !== loaded.models && loaded.snapshot) {
      loaded.runtime = new AgentRuntime({ models, project: loaded.snapshot });
      loaded.models = models;
    }
    const callerPersistence = options.persistence;
    return loaded.runtime.createSession({
      ...options,
      ...(options.id
        ? {
            persistence: {
              replaceMessages: async (messages: AgentMessage[]) => {
                await this._replaceRuntimeMessages(
                  projectId,
                  options.id!,
                  messages
                );
                await callerPersistence?.replaceMessages(messages);
              },
            },
          }
        : {}),
    });
  }

  async refresh(projectId: string): Promise<ExternalAgentProjectView> {
    await this._reload(projectId);
    return this.inspect(projectId);
  }

  shutdown(): Promise<void> {
    for (const id of [...this._loaded.keys()]) this._closeLoaded(id);
    return Promise.resolve();
  }

  private async _ensureRegistry(): Promise<void> {
    if (!this._loadedRegistry) {
      this._loadedRegistry = true;
      try {
        const parsed = JSON.parse(
          await readFile(this._settingsFile, "utf8")
        ) as Partial<RegistryFile>;
        for (const entry of parsed.projects ?? []) {
          if (typeof entry.path !== "string" || entry.trusted !== true)
            continue;
          const canonical = await realpath(entry.path).catch(() =>
            path.resolve(entry.path)
          );
          this._registry.set(_projectId(canonical), {
            path: canonical,
            trusted: true,
            origin: "registered",
          });
        }
      } catch (error) {
        if (!_hasCode(error, "ENOENT")) {
          console.error("Failed to load Agent Projects:", error);
        }
      }
    }
    await this._refreshWorkspaceProjects();
  }

  private async _refreshWorkspaceProjects(): Promise<void> {
    const discovered = new Set<string>();
    for (const projectRoot of await _discoverAgentProjects(
      this._workspaceRoot
    )) {
      const id = _projectId(projectRoot);
      discovered.add(id);
      this._registry.set(id, {
        path: projectRoot,
        trusted: true,
        origin: "workspace",
      });
    }
    for (const [id, entry] of this._registry) {
      if (entry.origin === "workspace" && !discovered.has(id)) {
        this._registry.delete(id);
        this._closeLoaded(id);
      }
    }
  }

  private async _saveRegistry(): Promise<void> {
    await mkdir(path.dirname(this._settingsFile), { recursive: true });
    const file: RegistryFile = {
      projects: [...this._registry.values()]
        .filter((entry) => entry.origin === "registered")
        .map(({ path: projectPath, trusted }) => ({
          path: projectPath,
          trusted,
        })),
    };
    await _atomicJsonWrite(this._settingsFile, file);
  }

  private async _ensureProject(projectId: string): Promise<void> {
    this._entry(projectId);
    if (!this._loaded.has(projectId)) await this._reload(projectId);
  }

  private async _reload(
    projectId: string,
    options: { resolved?: ResolvedAgentProjectManifest } = {}
  ): Promise<void> {
    const entry = this._entry(projectId);
    let state = this._loaded.get(projectId);
    if (!state) {
      state = {
        resolved: null,
        snapshot: null,
        error: null,
        missing: false,
        watcher: null,
        reloadTimer: null,
        snapshots: new Map(),
        runtime: null,
        models: null,
      };
      this._loaded.set(projectId, state);
    }
    try {
      await lstat(entry.path);
      const resolved =
        options.resolved ?? (await loadAgentProjectManifest(entry.path));
      if (_projectId(resolved.projectRoot) !== projectId) {
        throw new Error("The Agent Project canonical path changed.");
      }
      const snapshot = await loadAgentProject(resolved.agentRoot);
      state.resolved = resolved;
      state.snapshot = snapshot;
      state.missing = false;
      state.error = snapshot.diagnostics.some(
        (diagnostic) => diagnostic.severity === "error"
      )
        ? snapshot.diagnostics
            .map((diagnostic) => diagnostic.message)
            .join("\n")
        : null;
      if (!state.error) {
        const models = await this._getModels();
        state.runtime = new AgentRuntime({
          models,
          project: snapshot,
        });
        state.models = models;
      }
      state.snapshots.delete(snapshot.fingerprint);
      state.snapshots.set(snapshot.fingerprint, snapshot);
      this._ensureWatcher(projectId, state, resolved.projectRoot);
    } catch (error) {
      state.error = _message(error);
      state.missing = _hasCode(error, "ENOENT");
      if (_hasCode(error, "ENOENT")) {
        state.resolved = null;
        state.watcher?.close();
        state.watcher = null;
      }
    }
    this._notify(projectId);
  }

  private _ensureWatcher(
    projectId: string,
    state: LoadedProject,
    projectRoot: string
  ): void {
    if (state.watcher) return;
    state.watcher = watch(projectRoot, { recursive: true }, () => {
      if (state.reloadTimer) clearTimeout(state.reloadTimer);
      state.reloadTimer = setTimeout(() => {
        state.reloadTimer = null;
        void this._reload(projectId);
      }, 150);
    });
    state.watcher.on("error", (error) => {
      state.error = `Project watch failed: ${error.message}`;
      this._notify(projectId);
    });
  }

  private async _summary(
    projectId: string
  ): Promise<ExternalAgentProjectSummary> {
    const entry = this._entry(projectId);
    const loaded = this._state(projectId);
    return {
      id: projectId,
      name: path.basename(entry.path),
      path: entry.path,
      removable: entry.origin === "registered",
      status: loaded.resolved
        ? loaded.error
          ? "invalid"
          : "ready"
        : loaded.missing
          ? "missing"
          : "invalid",
      ...(loaded.error ? { error: loaded.error } : {}),
      threads: await this._listThreads(projectId),
    };
  }

  private async _listThreads(
    projectId: string
  ): Promise<ExternalAgentProjectThreadSummary[]> {
    const root = this._threadsRoot(projectId);
    let entries: string[];
    try {
      entries = await readdir(root);
    } catch (error) {
      if (_hasCode(error, "ENOENT")) return [];
      throw error;
    }
    const summaries = await Promise.all(
      entries
        .filter((entry) => entry.endsWith(".json"))
        .map(async (entry) => {
          const id = entry.slice(0, -5);
          try {
            const record = await this._readThreadFile(projectId, id);
            return { id, title: record.thread.title ?? "untitled" };
          } catch {
            return null;
          }
        })
    );
    return summaries
      .filter(
        (item): item is ExternalAgentProjectThreadSummary => item !== null
      )
      .sort((a, b) => a.title.localeCompare(b.title));
  }

  private async _ensureDefaultThread(projectId: string): Promise<void> {
    if ((await this._listThreads(projectId)).length === 0) {
      await this.createThread(projectId);
    }
  }

  private async _readThreadFile(
    projectId: string,
    threadId: string
  ): Promise<ThreadFile> {
    const parsed = JSON.parse(
      await readFile(this._threadFile(projectId, threadId), "utf8")
    ) as Partial<ThreadFile>;
    if (!parsed.thread || typeof parsed.promptFingerprint !== "string") {
      throw new Error("Invalid project Thread file.");
    }
    const thread = normalizeThread(parsed.thread);
    const current = this._state(projectId).snapshot;
    const syncedDefinition =
      parsed.syncedDefinition ??
      current?.definition ??
      _definitionFromModel(thread.model);
    if (!syncedDefinition) {
      throw new Error("Project Thread has no model definition to migrate.");
    }
    const definitionFingerprint =
      typeof parsed.definitionFingerprint === "string"
        ? parsed.definitionFingerprint
        : current?.definition
          ? _definitionFingerprint(current.definition)
          : _definitionFingerprint(syncedDefinition);
    const legacyDefinitionState =
      typeof parsed.definitionFingerprint !== "string" ||
      !parsed.syncedDefinition;
    const migrated = {
      thread: {
        ...thread,
        agentRuntime:
          thread.agentRuntime ??
          (current
            ? {
                projectId,
                snapshot: current.fingerprint,
                definitionFingerprint,
                modelSource: legacyDefinitionState
                  ? ("threadOverride" as const)
                  : _modelMatchesDefinition(thread.model, syncedDefinition)
                    ? ("agent" as const)
                    : ("threadOverride" as const),
              }
            : undefined),
      },
      promptFingerprint: parsed.promptFingerprint,
      syncedPrompt:
        typeof parsed.syncedPrompt === "string"
          ? parsed.syncedPrompt
          : (parsed.thread.context?.systemPrompt ?? ""),
      definitionFingerprint,
      syncedDefinition,
    };
    if (
      typeof parsed.definitionFingerprint !== "string" ||
      !parsed.syncedDefinition ||
      !parsed.thread.agentRuntime
    ) {
      await _atomicJsonWrite(this._threadFile(projectId, threadId), migrated);
    }
    return migrated;
  }

  private async _replaceRuntimeMessages(
    projectId: string,
    threadId: string,
    messages: AgentMessage[]
  ): Promise<void> {
    const record = await this._readThreadFile(projectId, threadId);
    await this._writeThreadFile(projectId, threadId, {
      ...record,
      thread: {
        ...record.thread,
        context: {
          ...record.thread.context,
          messages: convertFromPiMessages(
            messages,
            record.thread.context?.messages
          ),
        },
      },
    });
  }

  private async _writeThreadFile(
    projectId: string,
    threadId: string,
    record: ThreadFile
  ): Promise<void> {
    await mkdir(this._threadsRoot(projectId), { recursive: true });
    await _atomicJsonWrite(this._threadFile(projectId, threadId), record);
  }

  private async _agentRoot(projectId: string): Promise<string> {
    await this._ensureProject(projectId);
    const loaded = this._state(projectId);
    if (!loaded.resolved)
      throw new Error(loaded.error ?? "Project is missing.");
    return loaded.resolved.agentRoot;
  }

  private _entry(projectId: string): RegistryEntry {
    const entry = this._registry.get(projectId);
    if (!entry?.trusted)
      throw new Error("Agent Project is not trusted or open.");
    return entry;
  }

  private _state(projectId: string): LoadedProject {
    const state = this._loaded.get(projectId);
    if (!state) throw new Error("Agent Project is not loaded.");
    return state;
  }

  private _threadsRoot(projectId: string): string {
    return path.join(this._dataRoot, projectId, "threads");
  }

  private _threadFile(projectId: string, threadId: string): string {
    if (!/^[a-zA-Z0-9-]+$/.test(threadId)) {
      throw new Error("Invalid project Thread id.");
    }
    return path.join(this._threadsRoot(projectId), `${threadId}.json`);
  }

  private _closeLoaded(projectId: string): void {
    const state = this._loaded.get(projectId);
    if (!state) return;
    if (state.reloadTimer) clearTimeout(state.reloadTimer);
    state.watcher?.close();
    this._loaded.delete(projectId);
  }

  private _notify(projectId: string): void {
    this._onChange?.(projectId);
  }
}

function _projectTools(
  projectId: string,
  snapshot: AgentProjectSnapshot
): ProjectTool[] {
  return snapshot.tools.map((tool) => ({
    type: "project",
    projectId,
    snapshot: snapshot.fingerprint,
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }));
}

async function _discoverAgentProjects(root: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const projects: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const candidate = path.join(root, entry.name);
    let children;
    try {
      children = await readdir(candidate, { withFileTypes: true });
    } catch {
      continue;
    }
    const isProject = children.some(
      (child) =>
        (child.name === "llm-space.json" && child.isFile()) ||
        (child.name === "agent" && child.isDirectory())
    );
    if (isProject) {
      try {
        projects.push(await realpath(candidate));
      } catch {
        // The directory moved or disappeared between listing and resolution.
      }
    } else if (entry.name !== "node_modules") {
      projects.push(...(await _discoverAgentProjects(candidate)));
    }
  }
  return projects;
}

function _reconcileThread(
  input: Thread,
  project: ExternalAgentProjectView
): Thread {
  const thread = ensureThreadVariableState(normalizeThread(input));
  const enabledToolNames = new Set(
    (thread.context?.tools ?? [])
      .filter((tool) => tool.type === "project")
      .map((tool) => tool.name)
  );
  const tools = project.tools.filter((tool) => enabledToolNames.has(tool.name));
  return {
    ...thread,
    context: { ...thread.context, tools },
  };
}

async function _listSourceFiles(root: string, prefix = ""): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(path.join(root, prefix), { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries.toSorted((a, b) =>
    a.name.localeCompare(b.name)
  )) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory())
      files.push(...(await _listSourceFiles(root, relative)));
    else if (/\.(?:md|ts|js)$/.test(entry.name)) files.push(relative);
  }
  return files;
}

async function _safeExistingSource(
  root: string,
  relativePath: string
): Promise<string> {
  if (path.isAbsolute(relativePath) || relativePath.includes("\0")) {
    throw new Error("Source path must be relative.");
  }
  const candidate = path.resolve(root, relativePath);
  if (candidate !== root && !candidate.startsWith(root + path.sep)) {
    throw new Error("Source path escapes the Agent root.");
  }
  const info = await lstat(candidate);
  if (info.isSymbolicLink() || !info.isFile()) {
    throw new Error("Source path must be a regular non-symlink file.");
  }
  const canonical = await realpath(candidate);
  if (canonical !== root && !canonical.startsWith(root + path.sep)) {
    throw new Error("Source path escapes the Agent root.");
  }
  return canonical;
}

async function _atomicJsonWrite(target: string, value: unknown): Promise<void> {
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2) + "\n", "utf8");
  await rename(temporary, target);
}

function _projectId(root: string): string {
  return createHash("sha256").update(root).digest("hex").slice(0, 24);
}

function _within(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(root + path.sep);
}

function _textFingerprint(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function _definitionFingerprint(definition: ResolvedAgentDefinition): string {
  return _textFingerprint(JSON.stringify(definition));
}

function _modelFromDefinition(
  definition: ResolvedAgentDefinition,
  current?: ModelConfig
): ModelConfig {
  const params = { ...current?.params };
  if (definition.reasoning === undefined) delete params.reasoning;
  else params.reasoning = definition.reasoning;
  return {
    ...definition.model,
    ...(Object.keys(params).length > 0 ? { params } : {}),
  };
}

function _definitionFromModel(
  model: ModelConfig | undefined
): ResolvedAgentDefinition | undefined {
  if (!model) return undefined;
  return {
    model: { provider: model.provider, id: model.id },
    ...(model.params?.reasoning ? { reasoning: model.params.reasoning } : {}),
  };
}

function _modelMatchesDefinition(
  model: ModelConfig | undefined,
  definition: ResolvedAgentDefinition
): boolean {
  return (
    model?.provider === definition.model.provider &&
    model.id === definition.model.id &&
    model.params?.reasoning === definition.reasoning
  );
}

function _hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

function _message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
