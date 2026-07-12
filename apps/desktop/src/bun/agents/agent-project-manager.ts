import { randomUUID } from "node:crypto";
import { lstatSync, realpathSync } from "node:fs";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import {
  type AgentEvent,
  type AgentHarnessEvent,
  type AgentMessage,
  type AgentTool,
} from "@earendil-works/pi-agent-core";
import {
  createModels,
  Type,
  type Models,
  type Provider,
} from "@earendil-works/pi-ai";
import type { ModelConfig } from "@llm-space/core";
import {
  AgentProjectValidationError,
  LocalAgentRuntime,
  loadAgentProject,
  type AgentRuntimeSession,
} from "@llm-space/runtime/node";

import type {
  AgentProjectMessageView,
  AgentProjectView,
  AgentSessionKind,
  StreamAgentProjectRequestPayload,
  StreamAgentProjectResponsePayload,
} from "../../shared/agent-project";
import type { ModelManager } from "../models";

const PROJECT_STATE_DIR = ".llm-space";
const PROJECT_CONFIG_FILE = "project.json";
const AGENT_EVENT_TYPES = new Set<AgentEvent["type"]>([
  "agent_start",
  "agent_end",
  "turn_start",
  "turn_end",
  "message_start",
  "message_update",
  "message_end",
  "tool_execution_start",
  "tool_execution_update",
  "tool_execution_end",
]);

interface AgentProjectConfig {
  model?: ModelConfig;
  activeSessions?: Partial<Record<AgentSessionKind, string>>;
}

interface OpenSession {
  runtime: LocalAgentRuntime;
  session: AgentRuntimeSession;
  sessionId: string;
}

export class AgentProjectManager {
  private readonly _workspaceRoot: string;
  private readonly _canonicalWorkspaceRoot: string;
  private readonly _modelManager: ModelManager;
  private readonly _sessions = new Map<string, OpenSession>();
  private readonly _activeStreams = new Map<string, AgentRuntimeSession>();
  private readonly _runningSessions = new Set<string>();
  private readonly _nestedTargets = new Map<
    AgentRuntimeSession,
    AgentRuntimeSession
  >();

  constructor(options: { workspaceRoot: string; modelManager: ModelManager }) {
    this._workspaceRoot = path.resolve(options.workspaceRoot);
    this._canonicalWorkspaceRoot = realpathSync(this._workspaceRoot);
    this._modelManager = options.modelManager;
  }

  async inspect(projectPath: string): Promise<AgentProjectView> {
    const projectRoot = this._projectRoot(projectPath);
    const snapshot = await loadAgentProject(path.join(projectRoot, "agent"));
    const config = await this._readConfig(projectRoot);
    const [builder, target] = await Promise.all([
      this._sessionView(projectPath, "builder", config),
      this._sessionView(projectPath, "target", config),
    ]);
    return {
      path: projectPath,
      name: path.basename(projectRoot),
      model: config.model ?? null,
      instructions: snapshot.instructions,
      tools: snapshot.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
      })),
      skills: (snapshot.resources.skills ?? []).map((skill) => ({
        name: skill.name,
        description: skill.description,
      })),
      diagnostics: snapshot.diagnostics,
      sourceFiles: await _listFiles(path.join(projectRoot, "agent")),
      builder,
      target,
    };
  }

  async setModel(
    projectPath: string,
    model: ModelConfig
  ): Promise<AgentProjectView> {
    const projectRoot = this._projectRoot(projectPath);
    const config = await this._readConfig(projectRoot);
    config.model = model;
    await this._writeConfig(projectRoot, config);
    await this._closeProjectSessions(projectPath, "target");
    return this.inspect(projectPath);
  }

  async newSession(
    projectPath: string,
    kind: AgentSessionKind
  ): Promise<AgentProjectView> {
    const projectRoot = this._projectRoot(projectPath);
    const config = await this._readConfig(projectRoot);
    await this._closeProjectSessions(projectPath, kind);
    const runtime = await this._createLocalRuntime(projectRoot, kind);
    try {
      const model = await this._resolveModel(config, kind);
      const session = await runtime.createSession({
        id: randomUUID(),
        model,
        ...(kind === "builder"
          ? {
              extraTools: await this._builderTools(projectPath, projectRoot),
              instructionsPrefix: _builderInstructions(projectRoot),
              allowInvalidProject: true,
            }
          : {}),
      });
      config.activeSessions ??= {};
      config.activeSessions[kind] = (await session.getMetadata()).id;
      await this._writeConfig(projectRoot, config);
    } finally {
      await runtime.cleanup();
    }
    return this.inspect(projectPath);
  }

  async selectSession(
    projectPath: string,
    kind: AgentSessionKind,
    sessionId: string
  ): Promise<AgentProjectView> {
    const projectRoot = this._projectRoot(projectPath);
    const config = await this._readConfig(projectRoot);
    config.activeSessions ??= {};
    config.activeSessions[kind] = sessionId;
    await this._writeConfig(projectRoot, config);
    await this._closeProjectSessions(projectPath, kind);
    return this.inspect(projectPath);
  }

  async run(
    payload: StreamAgentProjectRequestPayload,
    send: (message: StreamAgentProjectResponsePayload) => void
  ): Promise<void> {
    const sessionKey = `${payload.projectPath}:${payload.kind}`;
    try {
      if (this._runningSessions.has(sessionKey)) {
        throw new Error(
          `${payload.kind === "builder" ? "Builder" : "Target"} is already running.`
        );
      }
      this._runningSessions.add(sessionKey);
      const open = await this._getOrCreateSession(
        payload.projectPath,
        payload.kind
      );
      this._activeStreams.set(payload.streamId, open.session);
      const unsubscribe = open.session.subscribe((event) => {
        if (_isAgentEvent(event)) {
          send({ streamId: payload.streamId, type: "event", event });
        }
      });
      try {
        await open.session.prompt(payload.text);
      } finally {
        unsubscribe();
        this._activeStreams.delete(payload.streamId);
      }
      send({
        streamId: payload.streamId,
        type: "done",
        project: await this.inspect(payload.projectPath),
      });
    } catch (error) {
      this._activeStreams.delete(payload.streamId);
      send({
        streamId: payload.streamId,
        type: "error",
        message: _errorMessage(error),
      });
    } finally {
      this._runningSessions.delete(sessionKey);
    }
  }

  abort(streamId: string): void {
    const session = this._activeStreams.get(streamId);
    if (!session) return;
    void session.abort();
    void this._nestedTargets.get(session)?.abort();
  }

  async shutdown(): Promise<void> {
    for (const session of this._activeStreams.values()) {
      try {
        await session.abort();
      } catch {
        // Best effort.
      }
    }
    this._activeStreams.clear();
    this._nestedTargets.clear();
    const runtimes = [...this._sessions.values()].map((entry) => entry.runtime);
    this._sessions.clear();
    await Promise.allSettled(runtimes.map((runtime) => runtime.cleanup()));
  }

  private async _getOrCreateSession(
    projectPath: string,
    kind: AgentSessionKind
  ): Promise<OpenSession> {
    const key = `${projectPath}:${kind}`;
    const cached = this._sessions.get(key);
    if (cached) {
      return cached;
    }
    const projectRoot = this._projectRoot(projectPath);
    const config = await this._readConfig(projectRoot);
    const model = await this._resolveModel(config, kind);
    const runtime = await this._createLocalRuntime(projectRoot, kind);
    const listed = await runtime.listSessions();
    const activeId = config.activeSessions?.[kind];
    const metadata = activeId
      ? listed.find((candidate) => candidate.id === activeId)
      : listed.toSorted((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    const options = {
      model,
      ...(kind === "builder"
        ? {
            extraTools: await this._builderTools(projectPath, projectRoot),
            instructionsPrefix: _builderInstructions(projectRoot),
            allowInvalidProject: true,
          }
        : {}),
    };
    const session = metadata
      ? await runtime.openSession({ metadata, ...options })
      : await runtime.createSession({ id: randomUUID(), ...options });
    const sessionMetadata = await session.getMetadata();
    config.activeSessions ??= {};
    config.activeSessions[kind] = sessionMetadata.id;
    await this._writeConfig(projectRoot, config);
    const open = { runtime, session, sessionId: sessionMetadata.id };
    this._sessions.set(key, open);
    return open;
  }

  private async _sessionView(
    projectPath: string,
    kind: AgentSessionKind,
    config: AgentProjectConfig
  ) {
    const projectRoot = this._projectRoot(projectPath);
    const runtime = await this._createLocalRuntime(projectRoot, kind);
    try {
      const sessions = (await runtime.listSessions()).toSorted((a, b) =>
        b.createdAt.localeCompare(a.createdAt)
      );
      const activeSessionId = config.activeSessions?.[kind] ?? null;
      const active = activeSessionId
        ? sessions.find((session) => session.id === activeSessionId)
        : sessions[0];
      let messages: AgentProjectMessageView[] = [];
      let changedFiles: string[] = [];
      if (active) {
        const model = await this._resolveModel(config, kind);
        const session = await runtime.openSession({
          metadata: active,
          model,
          ...(kind === "builder"
            ? {
                extraTools: await this._builderTools(projectPath, projectRoot),
                instructionsPrefix: _builderInstructions(projectRoot),
                allowInvalidProject: true,
              }
            : {}),
        });
        const contextMessages = (await session.getContext()).messages;
        messages = _messageViews(contextMessages);
        changedFiles = _changedFiles(contextMessages);
      }
      return {
        activeSessionId: active?.id ?? null,
        sessions: sessions.map(({ id, createdAt }) => ({ id, createdAt })),
        messages,
        changedFiles,
      };
    } finally {
      await runtime.cleanup();
    }
  }

  private async _createLocalRuntime(
    projectRoot: string,
    kind: AgentSessionKind
  ): Promise<LocalAgentRuntime> {
    return new LocalAgentRuntime({
      agentRoot: path.join(projectRoot, "agent"),
      sessionsRoot: path.join(projectRoot, PROJECT_STATE_DIR, "sessions", kind),
      models: await this._runtimeModels(),
    });
  }

  private async _runtimeModels(): Promise<Models> {
    const source = await this._modelManager.getAvailableModels();
    const models = createModels();
    for (const provider of source.getProviders()) {
      models.setProvider(this._runtimeProvider(provider));
    }
    return models;
  }

  private _runtimeProvider(provider: Provider): Provider {
    const originalApiKey = provider.auth.apiKey;
    return {
      id: provider.id,
      name: provider.name,
      baseUrl: provider.baseUrl,
      headers: provider.headers,
      auth: {
        ...provider.auth,
        apiKey: {
          name: originalApiKey?.name ?? `${provider.name} API key`,
          login: originalApiKey?.login?.bind(originalApiKey),
          resolve: async (input) => {
            const [apiKey, fallback] = await Promise.all([
              this._modelManager.getApiKey(provider.id),
              originalApiKey?.resolve(input),
            ]);
            const baseUrl = this._modelManager.getBaseUrl(provider.id);
            const headers = this._modelManager.getHeaders(provider.id);
            if (!apiKey && !baseUrl && !headers) return fallback;
            return {
              auth: {
                ...fallback?.auth,
                ...(apiKey ? { apiKey } : {}),
                ...(baseUrl ? { baseUrl } : {}),
                ...(headers ? { headers } : {}),
              },
              source: fallback?.source ?? "Desktop model settings",
            };
          },
        },
      },
      getModels: () => provider.getModels(),
      ...(provider.refreshModels
        ? { refreshModels: () => provider.refreshModels!() }
        : {}),
      stream: provider.stream.bind(provider),
      streamSimple: provider.streamSimple.bind(provider),
    };
  }

  private async _resolveModel(
    config: AgentProjectConfig,
    kind: AgentSessionKind
  ): Promise<ModelConfig> {
    const configured =
      kind === "target" ? config.model : this._modelManager.getDefaultModel();
    if (configured) {
      return configured;
    }
    const first = (
      await this._modelManager.getAvailableModels()
    ).getModels()[0];
    if (!first) {
      throw new Error("Configure a model before running an agent project.");
    }
    return { provider: first.provider, id: first.id };
  }

  private async _builderTools(
    projectPath: string,
    projectRoot: string
  ): Promise<AgentTool[]> {
    const agentRoot = path.join(projectRoot, "agent");
    const root = await realpath(agentRoot);
    const emptyParameters = Type.Object({});
    const readParameters = Type.Object({ path: Type.String() });
    const writeParameters = Type.Object({
      path: Type.String(),
      content: Type.String(),
    });
    const editParameters = Type.Object({
      path: Type.String(),
      oldText: Type.String(),
      newText: Type.String(),
    });
    const runTargetParameters = Type.Object({ prompt: Type.String() });
    const listTool: AgentTool<typeof emptyParameters> = {
      name: "builder_list_agent_files",
      label: "List agent files",
      description: "List source files in the active agent project.",
      parameters: emptyParameters,
      execute: async () => ({
        content: [{ type: "text", text: (await _listFiles(root)).join("\n") }],
        details: undefined,
      }),
    };
    const readTool: AgentTool<typeof readParameters> = {
      name: "builder_read_agent_file",
      label: "Read agent file",
      description: "Read a UTF-8 source file from the active agent project.",
      parameters: readParameters,
      execute: async (_toolCallId, { path: relativePath }) => ({
        content: [
          {
            type: "text",
            text: await readFile(
              await _safeExistingPath(root, relativePath),
              "utf8"
            ),
          },
        ],
        details: { path: relativePath },
      }),
    };
    const writeTool: AgentTool<typeof writeParameters> = {
      name: "builder_write_agent_file",
      label: "Write agent file",
      description:
        "Create or replace a UTF-8 source file in the active agent project.",
      parameters: writeParameters,
      execute: async (_toolCallId, { path: relativePath, content }) => {
        _assertWritableAgentSource(relativePath);
        const destination = await _safeWritablePath(root, relativePath);
        await mkdir(path.dirname(destination), { recursive: true });
        await writeFile(destination, content, "utf8");
        return {
          content: [{ type: "text", text: `Wrote ${relativePath}` }],
          details: { path: relativePath },
        };
      },
    };
    const editTool: AgentTool<typeof editParameters> = {
      name: "builder_edit_agent_file",
      label: "Edit agent file",
      description:
        "Replace one exact text occurrence in an active agent project file.",
      parameters: editParameters,
      execute: async (
        _toolCallId,
        { path: relativePath, oldText, newText }
      ) => {
        _assertWritableAgentSource(relativePath);
        const destination = await _safeExistingPath(root, relativePath);
        const source = await readFile(destination, "utf8");
        const first = source.indexOf(oldText);
        if (first === -1) {
          throw new Error(`Text not found in ${relativePath}`);
        }
        if (source.includes(oldText, first + oldText.length)) {
          throw new Error(`Text is not unique in ${relativePath}`);
        }
        await writeFile(
          destination,
          `${source.slice(0, first)}${newText}${source.slice(first + oldText.length)}`,
          "utf8"
        );
        return {
          content: [{ type: "text", text: `Edited ${relativePath}` }],
          details: { path: relativePath },
        };
      },
    };
    const validateTool: AgentTool<typeof emptyParameters> = {
      name: "builder_validate_agent_project",
      label: "Validate agent project",
      description:
        "Reload and validate the active agent project's instructions, tools, and skills without calling a model.",
      parameters: emptyParameters,
      execute: async () => {
        const snapshot = await loadAgentProject(root);
        const text =
          snapshot.diagnostics.length === 0
            ? `Agent project is valid (${snapshot.tools.length} tools, ${snapshot.resources.skills?.length ?? 0} skills).`
            : snapshot.diagnostics
                .map(
                  (diagnostic) =>
                    `${diagnostic.severity.toUpperCase()} ${diagnostic.path}: ${diagnostic.message}`
                )
                .join("\n");
        return {
          content: [{ type: "text", text }],
          details: { diagnostics: snapshot.diagnostics },
        };
      },
    };
    const runTargetTool: AgentTool<typeof runTargetParameters> = {
      name: "builder_run_target",
      label: "Run target agent",
      description:
        "Send a prompt to the project's persistent Target Agent session and inspect its Pi events, tool calls, results, and failures.",
      parameters: runTargetParameters,
      execute: async (_toolCallId, { prompt }) => ({
        content: [
          {
            type: "text",
            text: await this._runTargetForBuilder(projectPath, prompt),
          },
        ],
        details: { prompt },
      }),
    };
    return [
      listTool,
      readTool,
      writeTool,
      editTool,
      validateTool,
      runTargetTool,
    ];
  }

  private async _runTargetForBuilder(
    projectPath: string,
    prompt: string
  ): Promise<string> {
    const sessionKey = `${projectPath}:target`;
    if (this._runningSessions.has(sessionKey)) {
      throw new Error("Target is already running.");
    }
    this._runningSessions.add(sessionKey);
    let builderSession: AgentRuntimeSession | undefined;
    try {
      const open = await this._getOrCreateSession(projectPath, "target");
      builderSession = this._sessions.get(`${projectPath}:builder`)?.session;
      if (builderSession) {
        this._nestedTargets.set(builderSession, open.session);
      }
      const events: string[] = [];
      const unsubscribe = open.session.subscribe((event) => {
        const summary = _eventSummary(event);
        if (summary) events.push(summary);
      });
      try {
        await open.session.prompt(prompt);
      } finally {
        unsubscribe();
      }
      return events.length > 0
        ? `Target run completed.\n${events.join("\n")}`
        : "Target run completed without inspectable events.";
    } catch (error) {
      throw new Error(`Target run failed: ${_errorMessage(error)}`, {
        cause: error,
      });
    } finally {
      if (builderSession) this._nestedTargets.delete(builderSession);
      this._runningSessions.delete(sessionKey);
    }
  }

  private async _closeProjectSessions(
    projectPath: string,
    kind?: AgentSessionKind
  ): Promise<void> {
    for (const [key, open] of this._sessions) {
      if (
        key.startsWith(`${projectPath}:`) &&
        (kind === undefined || key === `${projectPath}:${kind}`)
      ) {
        await open.runtime.cleanup();
        this._sessions.delete(key);
      }
    }
  }

  private _projectRoot(projectPath: string): string {
    const root = path.resolve(this._workspaceRoot, projectPath);
    if (
      root !== this._workspaceRoot &&
      !root.startsWith(this._workspaceRoot + path.sep)
    ) {
      throw new Error("Agent project path escapes the workspace.");
    }
    if (lstatSync(root).isSymbolicLink()) {
      throw new Error("Agent Project roots cannot be symbolic links.");
    }
    const agentRoot = path.join(root, "agent");
    if (lstatSync(agentRoot).isSymbolicLink()) {
      throw new Error("Agent source roots cannot be symbolic links.");
    }
    const canonical = realpathSync(root);
    _assertUnderRoot(this._canonicalWorkspaceRoot, canonical);
    return canonical;
  }

  private async _readConfig(projectRoot: string): Promise<AgentProjectConfig> {
    try {
      return JSON.parse(
        await readFile(
          path.join(projectRoot, PROJECT_STATE_DIR, PROJECT_CONFIG_FILE),
          "utf8"
        )
      ) as AgentProjectConfig;
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return {};
      }
      throw error;
    }
  }

  private async _writeConfig(
    projectRoot: string,
    config: AgentProjectConfig
  ): Promise<void> {
    const stateRoot = path.join(projectRoot, PROJECT_STATE_DIR);
    await mkdir(stateRoot, { recursive: true });
    await writeFile(
      path.join(stateRoot, PROJECT_CONFIG_FILE),
      JSON.stringify(config, null, 2),
      "utf8"
    );
  }
}

function _isAgentEvent(event: AgentHarnessEvent): event is AgentEvent {
  return AGENT_EVENT_TYPES.has(event.type as AgentEvent["type"]);
}

function _messageViews(messages: AgentMessage[]): AgentProjectMessageView[] {
  const toolResults = new Map<string, { text: string; isError: boolean }>();
  for (const message of messages) {
    if (message.role !== "toolResult") continue;
    toolResults.set(message.toolCallId, {
      text: message.content
        .filter((item) => item.type === "text")
        .map((item) => item.text)
        .join("\n"),
      isError: message.isError,
    });
  }
  return messages
    .filter(
      (message) =>
        message.role === "user" ||
        message.role === "assistant" ||
        message.role === "toolResult"
    )
    .map((message) => {
      if (message.role === "user") {
        return {
          role: message.role,
          text:
            typeof message.content === "string"
              ? message.content
              : message.content
                  .filter((item) => item.type === "text")
                  .map((item) => item.text)
                  .join("\n"),
        };
      }
      if (message.role === "toolResult") {
        return {
          role: message.role,
          text: message.content
            .filter((item) => item.type === "text")
            .map((item) => item.text)
            .join("\n"),
        };
      }
      const text = message.content
        .filter((item) => item.type === "text")
        .map((item) => item.text)
        .join("\n");
      return {
        role: message.role,
        text:
          text ||
          (message.stopReason === "error"
            ? (message.errorMessage ?? "Model request failed.")
            : ""),
        toolCalls: message.content
          .filter((item) => item.type === "toolCall")
          .map((item) => {
            const result = toolResults.get(item.id);
            return {
              id: item.id,
              name: item.name,
              arguments: item.arguments,
              ...(result
                ? { result: result.text, isError: result.isError }
                : {}),
            };
          }),
      };
    });
}

function _changedFiles(messages: AgentMessage[]): string[] {
  const paths = new Set<string>();
  const latestUserIndex = messages.findLastIndex(
    (message) => message.role === "user"
  );
  for (const message of messages.slice(latestUserIndex + 1)) {
    if (
      message.role !== "toolResult" ||
      (message.toolName !== "builder_write_agent_file" &&
        message.toolName !== "builder_edit_agent_file")
    ) {
      continue;
    }
    const details: unknown = message.details;
    if (
      details &&
      typeof details === "object" &&
      "path" in details &&
      typeof details.path === "string"
    ) {
      paths.add(details.path);
    }
  }
  return [...paths].toSorted();
}

function _eventSummary(event: AgentHarnessEvent): string | null {
  if (!_isAgentEvent(event)) return null;
  if (event.type === "tool_execution_start") {
    return `TOOL CALL ${event.toolName} ${JSON.stringify(event.args)}`;
  }
  if (event.type === "tool_execution_end") {
    const result = event.result as {
      content?: { type: string; text?: string }[];
    };
    const text = result.content
      ?.filter((item) => item.type === "text")
      .map((item) => item.text ?? "")
      .join("\n");
    return `TOOL ${event.toolName} ${event.isError ? "FAILED" : "RESULT"}${text ? `: ${text}` : ""}`;
  }
  if (event.type === "message_end" && event.message.role === "assistant") {
    const text = event.message.content
      .filter((item) => item.type === "text")
      .map((item) => item.text)
      .join("\n");
    if (text) return `TARGET: ${text}`;
    return event.message.stopReason === "error"
      ? `TARGET FAILED: ${event.message.errorMessage ?? "Model request failed."}`
      : null;
  }
  return null;
}

async function _listFiles(root: string, current = root): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(current, { withFileTypes: true })) {
    if (entry.name === PROJECT_STATE_DIR) continue;
    const full = path.join(current, entry.name);
    if (entry.isDirectory()) {
      result.push(...(await _listFiles(root, full)));
    } else if (entry.isFile()) {
      result.push(path.relative(root, full));
    }
  }
  return result.toSorted();
}

async function _safeExistingPath(
  root: string,
  relativePath: string
): Promise<string> {
  const candidate = _safeLexicalPath(root, relativePath);
  await _assertNoSymlinkSegments(root, candidate);
  const canonical = await realpath(candidate);
  _assertUnderRoot(root, canonical);
  return canonical;
}

async function _safeWritablePath(
  root: string,
  relativePath: string
): Promise<string> {
  const candidate = _safeLexicalPath(root, relativePath);
  await _assertNoSymlinkSegments(root, candidate, true);
  let parent = path.dirname(candidate);
  while (parent !== root) {
    try {
      const metadata = await stat(parent);
      if (metadata.isDirectory()) break;
    } catch {
      // Walk upward to the nearest existing parent.
    }
    parent = path.dirname(parent);
  }
  const canonicalParent = await realpath(parent);
  _assertUnderRoot(root, canonicalParent);
  return candidate;
}

async function _assertNoSymlinkSegments(
  root: string,
  candidate: string,
  allowMissing = false
): Promise<void> {
  const relative = path.relative(root, candidate);
  let current = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try {
      if ((await lstat(current)).isSymbolicLink()) {
        throw new Error(
          "Symbolic links are not allowed in Builder file tools."
        );
      }
    } catch (error) {
      if (
        allowMissing &&
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return;
      }
      throw error;
    }
  }
}

function _safeLexicalPath(root: string, relativePath: string): string {
  if (!relativePath || path.isAbsolute(relativePath)) {
    throw new Error("Builder file paths must be non-empty and relative.");
  }
  const candidate = path.resolve(root, relativePath);
  _assertUnderRoot(root, candidate);
  return candidate;
}

function _assertWritableAgentSource(relativePath: string): void {
  const normalized = relativePath.split(path.sep).join("/");
  const allowed =
    normalized === "instructions.md" ||
    /^tools\/[^/]+\.ts$/.test(normalized) ||
    /^skills\/[^/]+\/.+/.test(normalized);
  if (!allowed) {
    throw new Error(
      "Builder can only write instructions.md, tools/*.ts, and files under skills/<name>/."
    );
  }
}

function _assertUnderRoot(root: string, candidate: string): void {
  if (candidate !== root && !candidate.startsWith(root + path.sep)) {
    throw new Error("Builder file path escapes the active agent project.");
  }
}

function _builderInstructions(projectRoot: string): string {
  return `You are LLM Space Builder, a senior agent engineer improving the active project at ${projectRoot}.
You are a real Pi agent. You can execute every tool defined by the target project and also use builder_* tools to inspect and edit its source.
Keep changes inside the active agent directory. Inspect before editing, preserve working behavior, validate after editing, run the Target Agent when useful, inspect its Pi tool results and failures, and explain what changed.`;
}

function _errorMessage(error: unknown): string {
  if (error instanceof AgentProjectValidationError) {
    return error.diagnostics.map((diagnostic) => diagnostic.message).join("\n");
  }
  return error instanceof Error ? error.message : String(error);
}
