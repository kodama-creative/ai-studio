import { createHash, randomUUID } from "node:crypto";
import { watch, type FSWatcher } from "node:fs";
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

import {
  normalizeThread,
  type ProjectTool,
  type Thread,
} from "@llm-space/core";
import {
  createDefaultThreadVariables,
  ensureThreadVariableState,
} from "@llm-space/core/thread";
import {
  loadAgentProject,
  loadAgentProjectManifest,
  type AgentProjectSnapshot,
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
}

interface RegistryFile {
  projects: RegistryEntry[];
}

interface LoadedProject {
  resolved: ResolvedAgentProjectManifest | null;
  snapshot: AgentProjectSnapshot | null;
  error: string | null;
  watcher: FSWatcher | null;
  reloadTimer: ReturnType<typeof setTimeout> | null;
  snapshots: Map<string, AgentProjectSnapshot>;
}

interface ThreadFile {
  thread: Thread;
  promptFingerprint: string;
  syncedPrompt: string;
}

export class ExternalAgentProjectManager {
  private readonly _settingsFile: string;
  private readonly _dataRoot: string;
  private readonly _registry = new Map<string, RegistryEntry>();
  private readonly _loaded = new Map<string, LoadedProject>();
  private _loadedRegistry = false;
  private _onChange: ((projectId: string) => void) | null = null;

  constructor(homePath: string) {
    this._settingsFile = path.join(
      homePath,
      "settings",
      "external-agent-projects.json"
    );
    this._dataRoot = path.join(homePath, "projects");
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
    this._registry.set(id, { path: resolved.projectRoot, trusted: true });
    await this._saveRegistry();
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
      status: loaded.error ? "invalid" : "ready",
      ...(loaded.error ? { error: loaded.error } : {}),
      threads,
      agentPath: loaded.resolved?.agentRoot ?? null,
      instructions: snapshot?.instructions ?? "",
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

  async syncThreadPrompt(
    projectId: string,
    threadId: string
  ): Promise<ExternalAgentProjectThreadRecord> {
    const project = await this.inspect(projectId);
    const record = await this.readThread(projectId, threadId);
    const next = {
      promptFingerprint: project.promptFingerprint,
      syncedPrompt: project.instructions,
      thread: {
        ...record.thread,
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

  async refresh(projectId: string): Promise<ExternalAgentProjectView> {
    await this._reload(projectId);
    return this.inspect(projectId);
  }

  shutdown(): Promise<void> {
    for (const id of [...this._loaded.keys()]) this._closeLoaded(id);
    return Promise.resolve();
  }

  private async _ensureRegistry(): Promise<void> {
    if (this._loadedRegistry) return;
    this._loadedRegistry = true;
    try {
      const parsed = JSON.parse(
        await readFile(this._settingsFile, "utf8")
      ) as Partial<RegistryFile>;
      for (const entry of parsed.projects ?? []) {
        if (typeof entry.path !== "string" || entry.trusted !== true) continue;
        const canonical = await realpath(entry.path).catch(() =>
          path.resolve(entry.path)
        );
        this._registry.set(_projectId(canonical), {
          path: canonical,
          trusted: true,
        });
      }
    } catch (error) {
      if (!_hasCode(error, "ENOENT")) {
        console.error("Failed to load external Agent Projects:", error);
      }
    }
  }

  private async _saveRegistry(): Promise<void> {
    await mkdir(path.dirname(this._settingsFile), { recursive: true });
    const file: RegistryFile = { projects: [...this._registry.values()] };
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
        watcher: null,
        reloadTimer: null,
        snapshots: new Map(),
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
      state.error = snapshot.diagnostics.some(
        (diagnostic) => diagnostic.severity === "error"
      )
        ? snapshot.diagnostics
            .map((diagnostic) => diagnostic.message)
            .join("\n")
        : null;
      state.snapshots.delete(snapshot.fingerprint);
      state.snapshots.set(snapshot.fingerprint, snapshot);
      this._ensureWatcher(projectId, state, resolved.projectRoot);
    } catch (error) {
      state.error = _message(error);
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
      status: loaded.resolved
        ? loaded.error
          ? "invalid"
          : "ready"
        : "missing",
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
    return {
      thread: normalizeThread(parsed.thread),
      promptFingerprint: parsed.promptFingerprint,
      syncedPrompt:
        typeof parsed.syncedPrompt === "string"
          ? parsed.syncedPrompt
          : (parsed.thread.context?.systemPrompt ?? ""),
    };
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

function _textFingerprint(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function _hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

function _message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
