import { createHash, randomUUID } from "node:crypto";
import { type FSWatcher, realpathSync, watch } from "node:fs";
import {
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import {
  getThreadRuntimeProfile,
  type ModelConfig,
  normalizeThread,
  type ProjectTool,
  sameSandboxAttachmentDescriptor,
  type SandboxAttachmentDescriptor,
  type Thread,
  type ThreadRuntimeProfileType
} from "@llm-space/core";
import {
  createDefaultThreadVariables,
  ensureThreadVariableState
} from "@llm-space/core/thread";
import {
  agentModelMatchesDefinition,
  type AgentProjectMcpConnectionPreset,
  type AgentProjectPreset,
  type CompiledAgentDefinition,
  isAgentProjectName
} from "@llm-space/runtime";
import {
  type AgentProjectArtifact,
  type AgentProjectSnapshot,
  AgentRuntime,
  type AgentSession,
  type CompiledAgentProjectSnapshot,
  createAgentProjectBundle,
  type CreateAgentSessionOptions,
  createHostCapabilityPolicy,
  loadAgentProject,
  loadAgentProjectBundle,
  loadAgentProjectManifest,
  type ProjectMcpConnectionStatus,
  type ProjectMcpConnector,
  ProjectMcpSession,
  ProjectMcpToolCallRejectedError,
  type ResolvedAgentProjectManifest,
  scaffoldAgentProject,
  type StagedSandboxAttachment
} from "@llm-space/runtime/node";

import type { Models } from "@earendil-works/pi-ai";

import { agentDefinitionFingerprint } from "./agent-definition-fingerprint";
import { createDesktopThreadRuntimeAuthority } from "../streaming/desktop-thread-runtime-authority";

import type {
  ExternalAgentProjectConnectionActivation,
  ExternalAgentProjectPreview,
  ExternalAgentProjectSummary,
  ExternalAgentProjectThreadRecord,
  ExternalAgentProjectThreadSummary,
  ExternalAgentProjectToolCallResponse,
  ExternalAgentProjectView,
  RemoteToolCallAttempt
} from "../../shared/external-agent-project";

interface RegistryEntry {
  path: string;
  trusted: boolean;
  origin: "registered" | "workspace";
}

interface RegistryFile {
  projects: Array<Pick<RegistryEntry, "path" | "trusted">>;
}

interface SandboxReadiness {
  readonly message?: string;
  readonly state: "ready" | "unavailable";
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
  connectionSessions: Map<string, ProjectConnectionSession>;
  connectionActivationEpochs: Map<string, number>;
  connectionActivationTails: Map<string, Promise<void>>;
  connectionReloadCount: number;
}

interface ProjectConnectionSession {
  snapshot: string;
  session: ProjectMcpSession;
  tools: ProjectTool[];
  connectionNames: Set<string>;
  unavailableConnections: Set<string>;
  driftConnections: Set<string>;
  blockedToolNames: Set<string>;
}

interface ThreadFile {
  thread: Thread;
  promptFingerprint: string;
  syncedPrompt: string;
  definitionFingerprint: string;
  syncedDefinition: CompiledAgentDefinition;
  modelSource?: NonNullable<Thread["agentRuntime"]>["modelSource"];
}

export class ExternalAgentProjectManager {
  private readonly _settingsFile: string;
  private readonly _dataRoot: string;
  private readonly _workspaceRoot: string;
  private readonly _compilerSupportPath?: string;
  private readonly _getModels: () => Promise<Models>;
  private readonly _projectMcpConnector?: ProjectMcpConnector;
  private readonly _sandboxReadiness?: () => Promise<SandboxReadiness>;
  private readonly _registry = new Map<string, RegistryEntry>();
  private readonly _loaded = new Map<string, LoadedProject>();
  private _loadedRegistry = false;
  private _onChange: ((projectId: string) => void) | null = null;

  constructor(options: {
    compilerSupportPath?: string;
    getModels?: () => Promise<Models>;
    homePath: string;
    projectMcpConnector?: ProjectMcpConnector;
    sandboxReadiness?: () => Promise<SandboxReadiness>;
    workspaceRoot: string;
  }) {
    const { homePath, workspaceRoot } = options;
    this._getModels =
      options.getModels
      ?? (async () =>
        Promise.resolve({ getModel: () => undefined } as unknown as Models));
    this._projectMcpConnector = options.projectMcpConnector;
    this._sandboxReadiness = options.sandboxReadiness;
    this._compilerSupportPath = options.compilerSupportPath;
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

  async create(options: {
    mcpConnection?: AgentProjectMcpConnectionPreset;
    name: string;
    parentDirectory: string;
    presets: readonly AgentProjectPreset[];
  }): Promise<ExternalAgentProjectView> {
    await this._ensureRegistry();
    if (!isAgentProjectName(options.name)) {
      throw new Error(
        "Agent Project name must use lowercase kebab-case letters and numbers."
      );
    }
    const parentDirectory = await realpath(options.parentDirectory);
    const directory = path.join(parentDirectory, options.name);
    const projectId = _projectId(directory);
    if (
      this._registry.has(projectId)
      || await _exists(path.join(this._dataRoot, projectId))
    ) {
      throw new Error(
        "Desktop already has registry or Thread data for this Agent Project path. Remove the old Agent Project or choose another name."
      );
    }
    const created = await scaffoldAgentProject({
      directory,
      presets: options.presets,
      ...(options.mcpConnection
        ? { mcpConnection: options.mcpConnection }
        : {})
    });
    try {
      const project = await this.trustAndOpen(created.directory);
      if (project.status !== "ready" || project.threads.length === 0) {
        throw new Error(
          project.error ?? "Created Agent Project did not open with a default Thread."
        );
      }
      return project;
    } catch (error) {
      this._registry.delete(projectId);
      await this._closeLoaded(projectId);
      const cleanup = await Promise.allSettled([
        this._saveRegistry(),
        rm(path.join(this._dataRoot, projectId), {
          recursive: true,
          force: true
        }),
        rm(created.directory, { recursive: true, force: true })
      ]);
      this._notify(projectId);
      const cleanupErrors: unknown[] = [];
      for (const result of cleanup) {
        if (result.status === "rejected") {
          cleanupErrors.push(result.reason);
        }
      }
      if (cleanupErrors.length > 0) {
        throw new AggregateError(
          [error, ...cleanupErrors],
          "Agent Project creation failed and cleanup was incomplete."
        );
      }
      throw error;
    }
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
      trusted: this._registry.get(id)?.trusted === true
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
      origin: inWorkspace ? "workspace" : "registered"
    });
    if (!inWorkspace) { await this._saveRegistry(); }
    await this._reload(id, { resolved });
    const view = await this.inspect(id);
    if (view.status !== "ready") { return view; }
    await this._ensureDefaultThread(id);
    return this.inspect(id);
  }

  async list(): Promise<ExternalAgentProjectSummary[]> {
    await this._ensureRegistry();
    return Promise.all(
      [...this._registry.keys()].map(async id => {
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
      artifactFingerprint: snapshot?.artifact?.fingerprint ?? "",
      instructions: snapshot?.instructions ?? "",
      definition: snapshot?.definition ?? null,
      definitionFingerprint: snapshot?.definition
        ? agentDefinitionFingerprint(snapshot.definition)
        : "",
      promptFingerprint: snapshot
        ? _textFingerprint(snapshot.instructions)
        : "",
      snapshot: snapshot?.fingerprint ?? "",
      sandboxRequired: Boolean(snapshot?.sandbox),
      tools: snapshot ? _projectTools(projectId, snapshot) : [],
      outputs: (snapshot?.outputDefinitions ?? []).map(output => ({
        name: output.name,
        description: output.description,
        schema: structuredClone(output.schema),
        schemaFingerprint: output.schemaFingerprint
      })),
      skills: snapshot
        ? (snapshot.resources.skills ?? []).map(skill => ({
          name: skill.name,
          description: skill.description,
          path: `project:${projectId}/skills/${skill.name}`,
          enabled: true
        }))
        : [],
      diagnostics: snapshot ? [...snapshot.diagnostics] : [],
      sourceFiles: loaded.resolved
        ? await _listSourceFiles(loaded.resolved.agentRoot)
        : []
    };
  }

  async remove(projectId: string): Promise<void> {
    await this._ensureRegistry();
    if (this._entry(projectId).origin === "workspace") {
      throw new Error("Workspace Agents are discovered automatically.");
    }
    this._registry.delete(projectId);
    await this._closeLoaded(projectId);
    await this._saveRegistry();
    this._notify(projectId);
  }

  async createThread(
    projectId: string,
    title = "untitled",
    runtimeProfileType?: ThreadRuntimeProfileType
  ): Promise<{ id: string; record: ExternalAgentProjectThreadRecord; }> {
    const view = await this.inspect(projectId);
    if (view.status !== "ready") {
      throw new Error(view.error ?? "Agent Project is invalid.");
    }
    if (!view.definition) {
      throw new Error("Agent Project has no valid definition.");
    }
    const selectedProfile = runtimeProfileType
      ?? (view.sandboxRequired ? "desktopSandbox" : "desktopDirect");
    if (view.sandboxRequired && selectedProfile === "desktopDirect") {
      throw new Error("This Agent requires Sandbox and cannot run Desktop Direct.");
    }
    if (selectedProfile === "desktopSandbox") {
      await this._assertSandboxReady();
    }
    const id = randomUUID();
    const variables = createDefaultThreadVariables();
    const skillVariable = variables.available_skills;
    if (skillVariable?.type === "skills") {
      variables.available_skills = {
        ...skillVariable,
        skillNames: view.skills.map(skill => skill.name)
      };
    }
    const thread: Thread = ensureThreadVariableState({
      title,
      ...(selectedProfile === "desktopDirect"
        ? { runtimeProfile: { version: 1 as const, type: "desktopDirect" as const } }
        : selectedProfile === "desktopSandbox"
          ? {
            runtimeProfile: {
              version: 1 as const,
              type: "desktopSandbox" as const
            }
          }
          : selectedProfile === "localServer"
            ? {
              runtimeProfile: {
                version: 1 as const,
                type: "localServer" as const,
                artifactFingerprint: view.artifactFingerprint
              }
            }
            : {}),
      model: _modelFromDefinition(view.definition),
      agentRuntime: {
        projectId,
        snapshot: view.snapshot,
        definitionFingerprint: view.definitionFingerprint,
        modelSource: "agent"
      },
      context: {
        systemPrompt: view.instructions,
        messages: [],
        tools: view.tools,
        variables
      }
    });
    const record = {
      thread,
      promptFingerprint: view.promptFingerprint,
      syncedPrompt: view.instructions,
      definitionFingerprint: view.definitionFingerprint,
      syncedDefinition: view.definition
    };
    await this._writeThreadFile(projectId, id, record);
    this._notify(projectId);
    return { id, record };
  }

  async readThread(
    projectId: string,
    threadId: string
  ): Promise<ExternalAgentProjectThreadRecord> {
    await this.inspect(projectId);
    const stored = await this._readThreadFile(projectId, threadId);
    return {
      promptFingerprint: stored.promptFingerprint,
      syncedPrompt: stored.syncedPrompt,
      definitionFingerprint: stored.definitionFingerprint,
      syncedDefinition: stored.syncedDefinition,
      thread: {
        ...ensureThreadVariableState(normalizeThread(stored.thread)),
        context: {
          ...stored.thread.context,
          tools: this._toolsForThread(projectId, threadId, stored.thread)
        }
      }
    };
  }

  async setRuntimeProfile(
    projectId: string,
    threadId: string,
    type: ThreadRuntimeProfileType
  ): Promise<ExternalAgentProjectThreadRecord> {
    const project = await this.inspect(projectId);
    if (project.status !== "ready" || !project.definition) {
      throw new Error(project.error ?? "Agent Project is invalid.");
    }
    if (project.sandboxRequired && type === "desktopDirect") {
      throw new Error("This Agent requires Sandbox and cannot run Desktop Direct.");
    }
    if (type === "desktopSandbox") {
      await this._assertSandboxReady();
    }
    const existing = await this._readThreadFile(projectId, threadId);
    const currentProfile = getThreadRuntimeProfile(existing.thread);
    if (
      currentProfile.type === type
      && (
        currentProfile.type !== "localServer"
        || currentProfile.artifactFingerprint === project.artifactFingerprint
      )
    ) {
      return this.readThread(projectId, threadId);
    }
    const runtimeProfile = type === "desktopDirect"
      ? { version: 1 as const, type }
      : type === "desktopSandbox"
        ? { version: 1 as const, type }
        : {
          version: 1 as const,
          type,
          artifactFingerprint: project.artifactFingerprint
        };
    await this._writeThreadFile(projectId, threadId, {
      ...existing,
      thread: {
        ...normalizeThread(existing.thread),
        runtimeProfile
      }
    });
    this._notify(projectId);
    return this.readThread(projectId, threadId);
  }

  async writeThread(
    projectId: string,
    threadId: string,
    record: ExternalAgentProjectThreadRecord
  ): Promise<void> {
    this._entry(projectId);
    const existing = await this._readThreadFile(projectId, threadId);
    _assertRuntimeProfileWrite(existing.thread, record.thread);
    await this._writeThreadFile(projectId, threadId, {
      thread: _reconcileSandboxThreadAuthority(
        existing.thread,
        normalizeThread(record.thread)
      ),
      promptFingerprint: record.promptFingerprint,
      syncedPrompt: record.syncedPrompt,
      definitionFingerprint: record.definitionFingerprint,
      syncedDefinition: record.syncedDefinition
    });
    this._notify(projectId);
  }

  async recordSandboxAttachments(
    projectId: string,
    threadId: string,
    messageId: string,
    attachments: readonly StagedSandboxAttachment[]
  ): Promise<void> {
    const existing = await this._readThreadFile(projectId, threadId);
    const thread = normalizeThread(existing.thread);
    if (getThreadRuntimeProfile(thread).type !== "desktopSandbox") {
      throw new Error("Files can be staged only for Desktop Sandbox.");
    }
    if (thread.lockedSandboxAttachmentMessageIds?.includes(messageId)) {
      throw new Error("Sandbox attachments are locked after Run starts.");
    }
    const message = thread.context?.messages?.find(
      candidate => candidate.id === messageId
    );
    if (message?.role !== "user") {
      throw new Error("Sandbox attachments require a user message.");
    }
    if (thread.sandboxAttachments?.[messageId]?.length) {
      throw new Error("This message already has Sandbox attachments.");
    }
    await this._writeThreadFile(projectId, threadId, {
      ...existing,
      thread: {
        ...thread,
        sandboxAttachments: {
          ...thread.sandboxAttachments,
          [messageId]: [...attachments]
        }
      }
    });
    this._notify(projectId);
  }

  async lockSandboxAttachments(
    projectId: string,
    threadId: string,
    messageIds: readonly string[]
  ): Promise<void> {
    const existing = await this._readThreadFile(projectId, threadId);
    const thread = normalizeThread(existing.thread);
    const selectedMessageIds = new Set(messageIds);
    const attachmentMessageIds = Object.keys(thread.sandboxAttachments ?? {})
      .filter(messageId => selectedMessageIds.has(messageId));
    if (attachmentMessageIds.length === 0) { return; }
    const locked = [...new Set([
      ...(thread.lockedSandboxAttachmentMessageIds ?? []),
      ...attachmentMessageIds
    ])].sort();
    await this._writeThreadFile(projectId, threadId, {
      ...existing,
      thread: { ...thread, lockedSandboxAttachmentMessageIds: locked }
    });
    this._notify(projectId);
  }

  async duplicateThread(
    projectId: string,
    threadId: string
  ): Promise<{ id: string; record: ExternalAgentProjectThreadRecord; }> {
    const source = await this.readThread(projectId, threadId);
    const id = randomUUID();
    const record = {
      ...source,
      thread: duplicateExternalAgentProjectThreadState(source.thread)
    };
    await this._writeThreadFile(projectId, id, record);
    this._notify(projectId);
    return { id, record };
  }

  async deleteThread(projectId: string, threadId: string): Promise<void> {
    await this.deactivateConnections(projectId, threadId);
    await rm(this._threadFile(projectId, threadId), { force: true });
    this._notify(projectId);
  }

  async bindLocalServerSession(
    projectId: string,
    threadId: string,
    input: { artifactFingerprint: string; sessionId: string; }
  ): Promise<ExternalAgentProjectThreadRecord> {
    const record = await this.readThread(projectId, threadId);
    const profile = record.thread.runtimeProfile;
    if (
      profile?.type !== "localServer"
      || profile.artifactFingerprint !== input.artifactFingerprint
    ) {
      throw new Error("Thread Local Server artifact binding changed.");
    }
    if (
      profile.serverSessionId
      && profile.serverSessionId !== input.sessionId
    ) {
      throw new Error("Thread already belongs to another Server Session.");
    }
    const next = {
      ...record,
      thread: {
        ...record.thread,
        runtimeProfile: {
          ...profile,
          serverSessionId: input.sessionId
        }
      }
    };
    await this._writeThreadFile(projectId, threadId, {
      thread: normalizeThread(next.thread),
      promptFingerprint: next.promptFingerprint,
      syncedPrompt: next.syncedPrompt,
      definitionFingerprint: next.definitionFingerprint,
      syncedDefinition: next.syncedDefinition
    });
    this._notify(projectId);
    return next;
  }

  async getCompiledProject(
    projectId: string,
    artifactFingerprint: string
  ): Promise<CompiledAgentProjectSnapshot> {
    await this._ensureRegistry();
    await this._ensureProject(projectId);
    const loaded = this._state(projectId);
    const cached = [...loaded.snapshots.values()].find(
      candidate => candidate.artifact?.fingerprint === artifactFingerprint
    );
    const snapshot = cached
      ?? await this._loadPersistedSnapshot(projectId, artifactFingerprint);
    if (!snapshot?.artifact) {
      throw new Error(
        "The Thread's compiled Agent artifact is no longer available."
      );
    }
    return snapshot as CompiledAgentProjectSnapshot;
  }

  async syncThreadFromAgent(
    projectId: string,
    threadId: string
  ): Promise<ExternalAgentProjectThreadRecord> {
    const project = await this.inspect(projectId);
    const record = await this.readThread(projectId, threadId);
    if (record.thread.runtimeProfile?.type === "localServer") {
      throw new Error(
        "A Local Server Thread cannot sync source fields. Use the latest artifact from its Runtime Profile control."
      );
    }
    if (
      project.sandboxRequired
      && getThreadRuntimeProfile(record.thread).type !== "desktopSandbox"
    ) {
      throw new Error(
        "The latest Agent requires Sandbox. Switch this Thread to Desktop Sandbox before syncing."
      );
    }
    if (!project.definition) {
      throw new Error("Agent Project has no valid definition.");
    }
    const active = this._state(projectId).connectionSessions.get(threadId);
    active?.driftConnections.clear();
    active?.blockedToolNames.clear();
    const tools = this._toolsForThread(projectId, threadId, record.thread);
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
          modelSource: "agent" as const
        },
        context: {
          ...record.thread.context,
          systemPrompt: project.instructions,
          tools
        }
      }
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

  async callTool(
    input: {
      arguments: Record<string, unknown>;
      attempt?: RemoteToolCallAttempt;
      callId: string;
      name: string;
      projectId: string;
      snapshot: string;
      threadId?: string;
    },
    abortSignal?: AbortSignal
  ): Promise<ExternalAgentProjectToolCallResponse> {
    try {
      await this._ensureProject(input.projectId);
    } catch (error) {
      return _rejectedToolCall(_message(error));
    }
    const loaded = this._state(input.projectId);
    const snapshot = loaded.snapshots.get(input.snapshot);
    if (!snapshot) {
      return _rejectedToolCall(
        "This Agent Project snapshot is no longer available. Refresh the Thread and run again."
      );
    }
    const tool = snapshot.tools.find(
      candidate => candidate.name === input.name
    );
    if (!tool) {
      if (!input.threadId) {
        return _rejectedToolCall(`Project tool not found: ${input.name}`);
      }
      const active = loaded.connectionSessions.get(input.threadId);
      if (active?.snapshot !== input.snapshot) {
        return _rejectedToolCall(
          "This Project MCP connection is not active. Reopen the Thread and retry manually."
        );
      }
      if (active.blockedToolNames.has(input.name)) {
        return _rejectedToolCall(
          "Remote action schema changed. Sync from Agent before calling it."
        );
      }
      if (!input.attempt) {
        return _rejectedToolCall(
          "Project MCP calls require a durable attempt marker."
        );
      }
      try {
        await this._markToolCallAttempt(
          input.projectId,
          input.threadId,
          input.attempt
        );
      } catch (error) {
        return _rejectedToolCall(_message(error));
      }
      try {
        return await active.session.callTool(
          input.name,
          input.arguments,
          abortSignal
        );
      } catch (error) {
        if (error instanceof ProjectMcpToolCallRejectedError) {
          return _rejectedToolCall(error.message);
        }
        throw error;
      }
    }
    const result = await tool.execute(input.callId, input.arguments);
    const text = result.content
      .filter(item => item.type === "text")
      .map(item => item.text)
      .join("\n");
    return { contentText: text, isError: false };
  }

  async activateConnections(
    projectId: string,
    threadId: string
  ): Promise<ExternalAgentProjectConnectionActivation> {
    await this._ensureProject(projectId);
    const loaded = this._state(projectId);
    if (loaded.connectionReloadCount > 0) {
      return _emptyConnectionActivation();
    }
    const activationEpoch = loaded.connectionActivationEpochs.get(threadId) ?? 0;
    loaded.connectionActivationEpochs.set(threadId, activationEpoch);
    const previousActivation = loaded.connectionActivationTails.get(threadId);
    let releaseActivation!: () => void;
    const activationTurn = new Promise<void>(resolve => {
      releaseActivation = resolve;
    });
    const activationTail = (previousActivation ?? Promise.resolve())
      .catch(() => undefined)
      .then(async () => activationTurn);
    loaded.connectionActivationTails.set(threadId, activationTail);
    await previousActivation?.catch(() => undefined);
    try {
      if (
        this._loaded.get(projectId) !== loaded
        || loaded.connectionActivationEpochs.get(threadId) !== activationEpoch
      ) {
        return _emptyConnectionActivation();
      }
      return await this._activateConnectionsNow(
        projectId,
        threadId,
        loaded,
        activationEpoch
      );
    } finally {
      releaseActivation();
      if (loaded.connectionActivationTails.get(threadId) === activationTail) {
        loaded.connectionActivationTails.delete(threadId);
      }
    }
  }

  private async _activateConnectionsNow(
    projectId: string,
    threadId: string,
    loaded: LoadedProject,
    activationEpoch: number
  ): Promise<ExternalAgentProjectConnectionActivation> {
    const snapshot = loaded.snapshot;
    if (loaded.error || !snapshot) {
      throw new Error(loaded.error ?? "Agent Project is unavailable.");
    }
    const previous = loaded.connectionSessions.get(threadId);
    loaded.connectionSessions.delete(threadId);
    await previous?.session.close();
    const session = await ProjectMcpSession.activate(snapshot.connections, {
      connector: this._projectMcpConnector
    });
    const activationIsCurrent = () =>
      this._loaded.get(projectId) === loaded
      && loaded.snapshot?.fingerprint === snapshot.fingerprint
      && loaded.connectionActivationEpochs.get(threadId) === activationEpoch;
    if (!activationIsCurrent()) {
      await session.close();
      return _emptyConnectionActivation();
    }
    const tools = _remoteProjectTools(projectId, snapshot, session.tools);
    const stored = await this._readThreadFile(projectId, threadId);
    if (!activationIsCurrent()) {
      await session.close();
      return _emptyConnectionActivation();
    }
    const storedRemote = (stored.thread.context?.tools ?? []).filter(
      (tool): tool is ProjectTool =>
        tool.type === "project" && Boolean(tool.connectionName)
    );
    const readyConnections = new Set(
      session.statuses
        .filter(status => status.state === "ready")
        .map(status => status.connectionName)
    );
    const connectionNames = new Set(
      snapshot.connections.map(connection => connection.name)
    );
    const unavailableConnections = new Set(
      session.statuses
        .filter(status => status.state === "unavailable")
        .map(status => status.connectionName)
    );
    const driftConnections = _schemaDriftConnections(
      storedRemote,
      tools,
      readyConnections,
      connectionNames,
      stored.thread.agentRuntime?.snapshot === snapshot.fingerprint
    );
    const blockedToolNames = new Set(
      storedRemote
        .filter(
          tool =>
            tool.connectionName
            && driftConnections.has(tool.connectionName)
        )
        .map(tool => tool.name)
    );
    loaded.connectionSessions.set(threadId, {
      snapshot: snapshot.fingerprint,
      session,
      tools,
      connectionNames,
      unavailableConnections,
      driftConnections,
      blockedToolNames
    });
    const reconciled = this._toolsForThread(projectId, threadId, stored.thread);
    if (
      JSON.stringify(reconciled)
      !== JSON.stringify(stored.thread.context?.tools ?? [])
    ) {
      await this._writeThreadFile(projectId, threadId, {
        ...stored,
        thread: {
          ...stored.thread,
          context: { ...stored.thread.context, tools: reconciled }
        }
      });
    }
    const statuses = session.statuses.map(status =>
      _connectionStatusWithDrift(status, driftConnections));
    for (const connectionName of driftConnections) {
      if (statuses.some(status => status.connectionName === connectionName)) {
        continue;
      }
      const previousTool = storedRemote.find(
        tool => tool.connectionName === connectionName
      );
      statuses.push({
        connectionName,
        description: "",
        sourcePath:
          previousTool?.sourcePath ?? `connections/${connectionName}.ts`,
        state: "drift",
        message: "Remote actions were removed. Sync from Agent before running."
      });
    }
    return {
      tools,
      statuses,
      hasSchemaDrift: driftConnections.size > 0
    };
  }

  async deactivateConnections(
    projectId: string,
    threadId: string
  ): Promise<void> {
    await this._ensureProject(projectId);
    const loaded = this._state(projectId);
    loaded.connectionActivationEpochs.set(
      threadId,
      (loaded.connectionActivationEpochs.get(threadId) ?? 0) + 1
    );
    const active = loaded.connectionSessions.get(threadId);
    loaded.connectionSessions.delete(threadId);
    await active?.session.close();
  }

  getActiveRemoteToolNames(
    projectId: string,
    threadId: string,
    snapshot: string
  ): Set<string> {
    const active = this._loaded
      .get(projectId)
      ?.connectionSessions.get(threadId);
    if (active?.snapshot !== snapshot) { return new Set(); }
    return new Set(
      active.tools
        .filter(
          tool =>
            tool.connectionName
            && !active.driftConnections.has(tool.connectionName)
        )
        .map(tool => tool.name)
    );
  }

  async createRuntimeSession(
    projectId: string,
    options: {
      capabilityPolicy?: CreateAgentSessionOptions["capabilityPolicy"];
      snapshot?: string;
    } & Omit<CreateAgentSessionOptions, "capabilityPolicy">
  ): Promise<AgentSession> {
    await this._ensureProject(projectId);
    const loaded = this._state(projectId);
    const { snapshot: snapshotFingerprint, ...sessionOptions } = options;
    const project = snapshotFingerprint
      ? await this._resolveSnapshot(projectId, snapshotFingerprint)
      : loaded.snapshot;
    if (!snapshotFingerprint && loaded.error) {
      throw new Error(loaded.error);
    }
    if (!project) {
      throw new Error(
        snapshotFingerprint
          ? "The Thread's frozen Agent snapshot is no longer available."
          : loaded.error ?? "Agent runtime is unavailable."
      );
    }
    const models = await this._getModels();
    if (models !== loaded.models && loaded.snapshot) {
      loaded.runtime = new AgentRuntime({ models, project: loaded.snapshot });
      loaded.models = models;
    }
    const runtime = project === loaded.snapshot && loaded.runtime
      ? loaded.runtime
      : new AgentRuntime({ models, project });
    return runtime.createSession({
      ...sessionOptions,
      capabilityPolicy: sessionOptions.capabilityPolicy
        ?? createHostCapabilityPolicy({
          extraTools: sessionOptions.extraTools,
          models,
          project
        })
    });
  }

  async createRuntimeSessionStore(
    projectId: string,
    threadId: string
  ) {
    this._entry(projectId);
    return createDesktopThreadRuntimeAuthority({
      read: async () => (await this._readThreadFile(projectId, threadId)).thread,
      write: async thread => {
        const current = await this._readThreadFile(projectId, threadId);
        await this._writeThreadFile(projectId, threadId, {
          ...current,
          thread
        });
        this._notify(projectId);
      }
    });
  }

  async refresh(projectId: string): Promise<ExternalAgentProjectView> {
    await this._reload(projectId);
    return this.inspect(projectId);
  }

  async shutdown(): Promise<void> {
    await Promise.all(
      [...this._loaded.keys()].map(async id => this._closeLoaded(id))
    );
  }

  private async _ensureRegistry(): Promise<void> {
    if (!this._loadedRegistry) {
      this._loadedRegistry = true;
      try {
        const parsed = JSON.parse(
          await readFile(this._settingsFile, "utf8")
        ) as Partial<RegistryFile>;
        for (const entry of parsed.projects ?? []) {
          if (
            typeof entry.path !== "string"
            || typeof entry.trusted !== "boolean"
            || !entry.trusted
          ) {
            continue;
          }
          const canonical = await realpath(entry.path).catch(() =>
            path.resolve(entry.path));
          this._registry.set(_projectId(canonical), {
            path: canonical,
            trusted: true,
            origin: "registered"
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
        origin: "workspace"
      });
    }
    for (const [id, entry] of this._registry) {
      if (entry.origin === "workspace" && !discovered.has(id)) {
        this._registry.delete(id);
        await this._closeLoaded(id);
      }
    }
  }

  private async _saveRegistry(): Promise<void> {
    await mkdir(path.dirname(this._settingsFile), { recursive: true });
    const file: RegistryFile = {
      projects: [...this._registry.values()]
        .filter(entry => entry.origin === "registered")
        .map(({ path: projectPath, trusted }) => ({
          path: projectPath,
          trusted
        }))
    };
    await _atomicJsonWrite(this._settingsFile, file);
  }

  private async _ensureProject(projectId: string): Promise<void> {
    this._entry(projectId);
    if (!this._loaded.has(projectId)) { await this._reload(projectId); }
  }

  private async _reload(
    projectId: string,
    options: { resolved?: ResolvedAgentProjectManifest; } = {}
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
        connectionSessions: new Map(),
        connectionActivationEpochs: new Map(),
        connectionActivationTails: new Map(),
        connectionReloadCount: 0
      };
      this._loaded.set(projectId, state);
    }
    let releaseConnectionReload: (() => void) | undefined;
    try {
      await lstat(entry.path);
      const resolved =
        options.resolved ?? (await loadAgentProjectManifest(entry.path));
      if (_projectId(resolved.projectRoot) !== projectId) {
        throw new Error("The Agent Project canonical path changed.");
      }
      const snapshot = await loadAgentProject(resolved.agentRoot);
      if (state.snapshot?.fingerprint !== snapshot.fingerprint) {
        state.runtime = null;
        state.models = null;
        state.connectionReloadCount += 1;
        let released = false;
        releaseConnectionReload = () => {
          if (released) { return; }
          released = true;
          state.connectionReloadCount -= 1;
        };
        for (const [threadId, epoch] of state.connectionActivationEpochs) {
          state.connectionActivationEpochs.set(threadId, epoch + 1);
        }
        await Promise.allSettled(
          [
            ...[...state.connectionSessions.values()].map(async active =>
              active.session.close()),
            ...state.connectionActivationTails.values()
          ]
        );
        state.connectionSessions.clear();
      }
      state.resolved = resolved;
      state.snapshot = snapshot;
      releaseConnectionReload?.();
      state.missing = false;
      state.error = snapshot.diagnostics.some(
        diagnostic => diagnostic.severity === "error"
      )
        ? snapshot.diagnostics
          .map(diagnostic => diagnostic.message)
          .join("\n")
        : null;
      if (!state.error) {
        await this._persistSnapshot(projectId, resolved, snapshot);
        const models = await this._getModels();
        state.runtime = new AgentRuntime({
          models,
          project: snapshot
        });
        state.models = models;
      }
      state.snapshots.delete(snapshot.fingerprint);
      state.snapshots.set(snapshot.fingerprint, snapshot);
      this._ensureWatcher(projectId, state, resolved.projectRoot);
    } catch (error) {
      releaseConnectionReload?.();
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

  private async _resolveSnapshot(
    projectId: string,
    fingerprint: string
  ): Promise<AgentProjectSnapshot | null> {
    const loaded = this._state(projectId);
    return loaded.snapshots.get(fingerprint)
      ?? await this._loadPersistedSnapshot(projectId, fingerprint);
  }

  private async _loadPersistedSnapshot(
    projectId: string,
    fingerprint: string
  ): Promise<CompiledAgentProjectSnapshot | null> {
    if (!/^[a-f0-9]{64}$/.test(fingerprint)) {
      throw new Error("Invalid frozen Agent snapshot fingerprint.");
    }
    const directory = this._snapshotRoot(projectId, fingerprint);
    let artifact: AgentProjectArtifact;
    try {
      artifact = JSON.parse(
        await readFile(path.join(directory, "artifact.json"), "utf8")
      ) as AgentProjectArtifact;
    } catch (error) {
      if (_hasCode(error, "ENOENT")) { return null; }
      throw error;
    }
    if (artifact.fingerprint !== fingerprint) {
      throw new Error("Persisted Agent snapshot fingerprint does not match.");
    }
    const snapshot = await loadAgentProjectBundle(
      path.join(directory, "agent.bundle.mjs"),
      artifact
    );
    this._state(projectId).snapshots.set(fingerprint, snapshot);
    return snapshot;
  }

  private async _persistSnapshot(
    projectId: string,
    resolved: ResolvedAgentProjectManifest,
    snapshot: CompiledAgentProjectSnapshot
  ): Promise<void> {
    const directory = this._snapshotRoot(projectId, snapshot.fingerprint);
    const bundlePath = path.join(directory, "agent.bundle.mjs");
    const artifactPath = path.join(directory, "artifact.json");
    if (await _exists(bundlePath) && await _exists(artifactPath)) { return; }
    const built = await createAgentProjectBundle(
      resolved.agentRoot,
      this._compilerSupportPath
        ? { compilerSupportPath: this._compilerSupportPath }
        : undefined
    );
    if (
      built.artifact.fingerprint !== snapshot.fingerprint
      || JSON.stringify(built.artifact) !== JSON.stringify(snapshot.artifact)
    ) {
      throw new Error("Persisted Agent bundle does not match its snapshot.");
    }
    await mkdir(directory, { recursive: true });
    await _atomicTextWrite(bundlePath, built.bundle);
    await _atomicJsonWrite(artifactPath, built.artifact);
  }

  private _ensureWatcher(
    projectId: string,
    state: LoadedProject,
    projectRoot: string
  ): void {
    if (state.watcher) { return; }
    state.watcher = watch(projectRoot, { recursive: true }, () => {
      if (state.reloadTimer) { clearTimeout(state.reloadTimer); }
      state.reloadTimer = setTimeout(() => {
        state.reloadTimer = null;
        void this._reload(projectId);
      }, 150);
    });
    state.watcher.on("error", error => {
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
      threads: await this._listThreads(projectId)
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
      if (_hasCode(error, "ENOENT")) { return []; }
      throw error;
    }
    const summaries = await Promise.all(
      entries
        .filter(entry => entry.endsWith(".json"))
        .map(async entry => {
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
      const project = this._state(projectId).snapshot;
      if (project?.sandbox && !await this._sandboxReady()) {
        return;
      }
      await this.createThread(projectId);
    }
  }

  private async _assertSandboxReady(): Promise<void> {
    const readiness = await this._sandboxReadiness?.();
    if (readiness?.state !== "ready") {
      throw new Error(
        readiness?.message ?? "The Desktop Host has no SandboxProvider."
      );
    }
  }

  private async _sandboxReady(): Promise<boolean> {
    return (await this._sandboxReadiness?.())?.state === "ready";
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
      parsed.syncedDefinition
      ?? current?.definition
      ?? _definitionFromModel(thread.model);
    if (!syncedDefinition) {
      throw new Error("Project Thread has no model definition to migrate.");
    }
    const definitionFingerprint =
      typeof parsed.definitionFingerprint === "string"
        ? parsed.definitionFingerprint
        : current?.definition
          ? agentDefinitionFingerprint(current.definition)
          : agentDefinitionFingerprint(syncedDefinition);
    const legacyDefinitionState =
      typeof parsed.definitionFingerprint !== "string"
      || !parsed.syncedDefinition;
    const modelSource =
      parsed.modelSource
      ?? thread.agentRuntime?.modelSource
      ?? (legacyDefinitionState
        ? "threadOverride"
        : agentModelMatchesDefinition({
          model: thread.model,
          reasoning: thread.model?.params?.reasoning,
          definition: syncedDefinition
        })
          ? "agent"
          : "threadOverride");
    const migrated = {
      thread: {
        ...thread,
        agentRuntime:
          thread.agentRuntime
          ?? (current
            ? {
              projectId,
              snapshot: current.fingerprint,
              definitionFingerprint,
              modelSource
            }
            : undefined)
      },
      promptFingerprint: parsed.promptFingerprint,
      syncedPrompt:
        typeof parsed.syncedPrompt === "string"
          ? parsed.syncedPrompt
          : (parsed.thread.context?.systemPrompt ?? ""),
      definitionFingerprint,
      syncedDefinition,
      modelSource
    };
    if (
      typeof parsed.definitionFingerprint !== "string"
      || !parsed.syncedDefinition
      || !parsed.thread.agentRuntime
    ) {
      await _atomicJsonWrite(this._threadFile(projectId, threadId), migrated);
    }
    return migrated;
  }

  private async _markToolCallAttempt(
    projectId: string,
    threadId: string,
    attempt: RemoteToolCallAttempt
  ): Promise<void> {
    const record = await this._readThreadFile(projectId, threadId);
    let found = false;
    const messages = (record.thread.context?.messages ?? []).map(message => {
      if (message.id !== attempt.messageId || message.role !== "assistant") {
        return message;
      }
      const toolCalls = message.toolCalls?.map(toolCall => {
        if (toolCall.id !== attempt.toolCallId) { return toolCall; }
        found = true;
        return {
          ...toolCall,
          attempt: { status: "started" as const, at: attempt.at }
        };
      });
      return { ...message, toolCalls };
    });
    if (!found) {
      throw new Error("Project MCP tool call is no longer present in the Thread.");
    }
    await this._writeThreadFile(projectId, threadId, {
      ...record,
      thread: {
        ...record.thread,
        context: { ...record.thread.context, messages }
      }
    });
  }

  private async _writeThreadFile(
    projectId: string,
    threadId: string,
    record: ThreadFile
  ): Promise<void> {
    await mkdir(this._threadsRoot(projectId), { recursive: true });
    await _atomicJsonWrite(this._threadFile(projectId, threadId), {
      ...record,
      modelSource:
        record.thread.agentRuntime?.modelSource ?? record.modelSource
    });
  }

  private async _agentRoot(projectId: string): Promise<string> {
    await this._ensureProject(projectId);
    const loaded = this._state(projectId);
    if (!loaded.resolved) { throw new Error(loaded.error ?? "Project is missing."); }
    return loaded.resolved.agentRoot;
  }

  private _entry(projectId: string): RegistryEntry {
    const entry = this._registry.get(projectId);
    if (!entry?.trusted) { throw new Error("Agent Project is not trusted or open."); }
    return entry;
  }

  private _state(projectId: string): LoadedProject {
    const state = this._loaded.get(projectId);
    if (!state) { throw new Error("Agent Project is not loaded."); }
    return state;
  }

  private _toolsForThread(
    projectId: string,
    threadId: string,
    thread: Thread
  ): ProjectTool[] {
    const loaded = this._state(projectId);
    const snapshot = loaded.snapshot;
    if (!snapshot) {
      return (thread.context?.tools ?? []).filter(
        (tool): tool is ProjectTool => tool.type === "project"
      );
    }
    const local = _projectTools(projectId, snapshot);
    const active = loaded.connectionSessions.get(threadId);
    const storedRemote = (thread.context?.tools ?? []).filter(
      (tool): tool is ProjectTool =>
        tool.type === "project" && Boolean(tool.connectionName)
    );
    if (active?.snapshot !== snapshot.fingerprint) {
      return [...local, ...storedRemote];
    }
    const remote: ProjectTool[] = [];
    const connectionNames = new Set([
      ...active.connectionNames,
      ...storedRemote.map(tool => tool.connectionName!)
    ]);
    for (const connectionName of connectionNames) {
      const current = active.tools.filter(
        tool => tool.connectionName === connectionName
      );
      const stored = storedRemote.filter(
        tool => tool.connectionName === connectionName
      );
      remote.push(
        ...(active.driftConnections.has(connectionName)
          || active.unavailableConnections.has(connectionName)
          ? stored
          : current)
      );
    }
    return [...local, ...remote];
  }

  private _threadsRoot(projectId: string): string {
    return path.join(this._dataRoot, projectId, "threads");
  }

  private _snapshotRoot(projectId: string, fingerprint: string): string {
    return path.join(this._dataRoot, projectId, "snapshots", fingerprint);
  }

  private _threadFile(projectId: string, threadId: string): string {
    if (!/^[a-zA-Z0-9-]+$/.test(threadId)) {
      throw new Error("Invalid project Thread id.");
    }
    return path.join(this._threadsRoot(projectId), `${threadId}.json`);
  }

  private async _closeLoaded(projectId: string): Promise<void> {
    const state = this._loaded.get(projectId);
    if (!state) { return; }
    if (state.reloadTimer) { clearTimeout(state.reloadTimer); }
    state.watcher?.close();
    const closeSessions = [...state.connectionSessions.values()].map(
      async active => active.session.close()
    );
    const pendingActivations = [...state.connectionActivationTails.values()];
    state.connectionSessions.clear();
    this._loaded.delete(projectId);
    await Promise.allSettled([...closeSessions, ...pendingActivations]);
  }

  private _notify(projectId: string): void {
    this._onChange?.(projectId);
  }
}

export function duplicateExternalAgentProjectThreadState(
  source: Thread
): Thread {
  const normalized = normalizeThread(source);
  const profile = getThreadRuntimeProfile(normalized);
  const {
    evaluations: _evaluations,
    lockedSandboxAttachmentMessageIds: _lockedSandboxAttachmentMessageIds,
    runHistory: _runHistory,
    runtimeSession: _runtimeSession,
    runtimeWorkingBase: _runtimeWorkingBase,
    sandboxAttachments: _sandboxAttachments,
    ...editable
  } = normalized;
  const context = editable.context
    ? (() => {
      const { snapshot: _snapshot, ...editableContext } = editable.context;
      return editableContext;
    })()
    : undefined;
  const runtimeProfile = profile.type === "localServer"
    ? {
      version: 1 as const,
      type: profile.type,
      artifactFingerprint: profile.artifactFingerprint
    }
    : { version: 1 as const, type: profile.type };
  return {
    ...editable,
    title: `${normalized.title ?? "untitled"} copy`,
    runtimeProfile,
    ...(context ? { context } : {})
  };
}

function _projectTools(
  projectId: string,
  snapshot: AgentProjectSnapshot
): ProjectTool[] {
  return snapshot.tools.map(tool => ({
    type: "project",
    projectId,
    snapshot: snapshot.fingerprint,
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    sourcePath: tool.sourcePath ?? `tools/${tool.name}.ts`
  }));
}

function _remoteProjectTools(
  projectId: string,
  snapshot: AgentProjectSnapshot,
  tools: ProjectMcpSession["tools"]
): ProjectTool[] {
  return tools.map(tool => ({
    type: "project",
    projectId,
    snapshot: snapshot.fingerprint,
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    sourcePath: tool.sourcePath,
    connectionName: tool.connectionName,
    remoteToolName: tool.remoteToolName,
    schemaFingerprint: tool.schemaFingerprint
  }));
}

function _schemaDriftConnections(
  stored: readonly ProjectTool[],
  current: readonly ProjectTool[],
  readyConnections: ReadonlySet<string>,
  currentConnections: ReadonlySet<string>,
  threadMatchesSnapshot: boolean
): Set<string> {
  const drift = new Set<string>();
  const storedConnections = new Set<string>();
  for (const tool of stored) {
    if (tool.connectionName) { storedConnections.add(tool.connectionName); }
  }
  const connectionNames = new Set([
    ...storedConnections,
    ...currentConnections
  ]);
  for (const connectionName of connectionNames) {
    if (!currentConnections.has(connectionName)) {
      drift.add(connectionName);
      continue;
    }
    if (!readyConnections.has(connectionName)) { continue; }
    const previous = stored
      .filter(tool => tool.connectionName === connectionName)
      .map(tool => `${tool.name}:${tool.schemaFingerprint ?? ""}`)
      .sort();
    const next = current
      .filter(tool => tool.connectionName === connectionName)
      .map(tool => `${tool.name}:${tool.schemaFingerprint ?? ""}`)
      .sort();
    if (previous.length === 0 && threadMatchesSnapshot) { continue; }
    if (JSON.stringify(previous) !== JSON.stringify(next)) {
      drift.add(connectionName);
    }
  }
  return drift;
}

function _connectionStatusWithDrift(
  status: ProjectMcpConnectionStatus,
  driftConnections: ReadonlySet<string>
) {
  if (!driftConnections.has(status.connectionName)) { return status; }
  return {
    connectionName: status.connectionName,
    description: status.description,
    sourcePath: status.sourcePath,
    state: "drift" as const,
    message: "Remote tool schemas changed. Sync from Agent before running."
  };
}

function _emptyConnectionActivation(): ExternalAgentProjectConnectionActivation {
  return { tools: [], statuses: [], hasSchemaDrift: false };
}

function _rejectedToolCall(
  message: string
): ExternalAgentProjectToolCallResponse {
  return { rejected: true, message };
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
    if (!entry.isDirectory() || entry.name.startsWith(".")) { continue; }
    const candidate = path.join(root, entry.name);
    let children;
    try {
      children = await readdir(candidate, { withFileTypes: true });
    } catch {
      continue;
    }
    const isProject = children.some(
      child =>
        (child.name === "llm-space.json" && child.isFile())
        || (child.name === "agent" && child.isDirectory())
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

async function _listSourceFiles(root: string, prefix = ""): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(path.join(root, prefix), { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries.toSorted((a, b) =>
    a.name.localeCompare(b.name))) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) { files.push(...(await _listSourceFiles(root, relative))); } else if (/\.(?:md|ts|js)$/.test(entry.name)) { files.push(relative); }
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
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, target);
}

async function _atomicTextWrite(target: string, value: string): Promise<void> {
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, value, "utf8");
  await rename(temporary, target);
}

function _projectId(root: string): string {
  return createHash("sha256").update(root).digest("hex")
    .slice(0, 24);
}

function _within(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(root + path.sep);
}

function _textFingerprint(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function _modelFromDefinition(
  definition: CompiledAgentDefinition,
  current?: ModelConfig
): ModelConfig {
  const params = { ...current?.params };
  if (definition.reasoning === undefined) { delete params.reasoning; } else { params.reasoning = definition.reasoning; }
  return {
    ...definition.model,
    ...(Object.keys(params).length > 0 ? { params } : {})
  };
}

function _definitionFromModel(
  model: ModelConfig | undefined
): CompiledAgentDefinition | undefined {
  if (!model) { return undefined; }
  return {
    model: { provider: model.provider, id: model.id },
    ...(model.params?.reasoning ? { reasoning: model.params.reasoning } : {})
  };
}

function _reconcileSandboxThreadAuthority(
  current: Thread,
  requested: Thread
): Thread {
  const currentAttachments = current.sandboxAttachments ?? {};
  const requestedAttachments = requested.sandboxAttachments ?? {};
  const messageIds = new Set(
    requested.context?.messages?.map(message => message.id) ?? []
  );
  const locked = [...new Set(
    current.lockedSandboxAttachmentMessageIds ?? []
  )].sort();
  const lockedIds = new Set(locked);
  const attachments: Record<string, SandboxAttachmentDescriptor[]> = {};

  for (const [messageId, proposed] of Object.entries(requestedAttachments)) {
    if (!messageIds.has(messageId)) { continue; }
    const approved = currentAttachments[messageId];
    if (!approved) {
      if (proposed.length > 0) {
        throw new Error("Sandbox attachment descriptors are owned by Desktop Bun.");
      }
      continue;
    }
    const approvedById = new Map(
      approved.map(descriptor => [descriptor.id, descriptor])
    );
    if (new Set(proposed.map(descriptor => descriptor.id)).size !== proposed.length) {
      throw new Error("Sandbox attachment descriptors are immutable.");
    }
    const accepted = proposed.map(descriptor => {
      const authoritative = approvedById.get(descriptor.id);
      if (!authoritative || !sameSandboxAttachmentDescriptor(
        authoritative,
        descriptor
      )) {
        throw new Error("Sandbox attachment descriptors are immutable.");
      }
      return authoritative;
    });
    if (lockedIds.has(messageId) && accepted.length !== approved.length) {
      throw new Error("Sandbox attachments are locked after Run starts.");
    }
    if (accepted.length > 0) { attachments[messageId] = accepted; }
  }

  for (const messageId of Object.keys(currentAttachments)) {
    if (
      messageIds.has(messageId)
      && lockedIds.has(messageId)
      && requestedAttachments[messageId] === undefined
    ) {
      throw new Error("Sandbox attachments are locked after Run starts.");
    }
  }

  return {
    ...requested,
    sandboxAttachments: Object.keys(attachments).length > 0
      ? attachments
      : undefined,
    lockedSandboxAttachmentMessageIds: locked.length > 0 ? locked : undefined
  };
}

function _assertRuntimeProfileWrite(current: Thread, next: Thread): void {
  const currentProfile = getThreadRuntimeProfile(current);
  const nextProfile = getThreadRuntimeProfile(next);
  const hasAuthority =
    current.runtimeSession !== undefined
    || Boolean(current.runHistory?.length)
    || (
      currentProfile.type === "localServer"
      && Boolean(currentProfile.serverSessionId)
    );
  if (
    hasAuthority
    && JSON.stringify(currentProfile) !== JSON.stringify(nextProfile)
  ) {
    throw new Error(
      "Change the Runtime Profile through the Desktop profile selector."
    );
  }
  if (
    (currentProfile.type === "localServer"
      ? currentProfile.serverSessionId
      : undefined)
    !== (nextProfile.type === "localServer"
      ? nextProfile.serverSessionId
      : undefined)
  ) {
    throw new Error("Only the Desktop Bun process may bind a Server Session.");
  }
}

function _hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

async function _exists(target: string): Promise<boolean> {
  try {
    await lstat(target);
    return true;
  } catch (error) {
    if (_hasCode(error, "ENOENT")) { return false; }
    throw error;
  }
}

function _message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
