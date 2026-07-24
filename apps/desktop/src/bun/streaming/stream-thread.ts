import {
  type BuiltinTool,
  type CustomModel,
  isDangerousBashCommand,
  type McpTool,
  type ProjectTool,
  type Tool
} from "@llm-space/core";
import { type LocalFileSystem, streamAgent } from "@llm-space/core/server";
import { agentModelMatchesDefinition } from "@llm-space/runtime";
import {
  decideRuntimeToolApproval,
  runtimeRunHasParkedToolApprovals
} from "@llm-space/runtime/harness";
import {
  AgentHostPolicyChangedError,
  type AgentProjectSnapshot,
  AgentRuntime,
  type AgentSession,
  AgentStateCommitUnknownError,
  createHostCapabilityPolicy,
  DurableOperationOutcomeUnknownError,
  ExecutionEnvUnavailableError,
  type PreparedAgentTool,
  RuntimeToolApprovalStaleError,
  SandboxUnavailableError,
  SandboxWorkspaceLostError,
  StructuredOutputError
} from "@llm-space/runtime/node";

import type {
  AgentMessage,
  StreamFn
} from "@earendil-works/pi-agent-core";
import type {
  SessionStore,
  StoredRuntimeSession
} from "@llm-space/runtime/harness";

import { createDesktopThreadRuntimeAuthority } from "./desktop-thread-runtime-authority";
import { agentDefinitionFingerprint } from "../external-projects/agent-definition-fingerprint";

import type {
  AbortStreamThreadPayload,
  StreamThreadRequestPayload,
  StreamThreadResponsePayload
} from "../../shared/rpc";
import type { Analytics } from "../analytics";
import type { ExternalAgentProjectManager } from "../external-projects";
import type { EmbeddedLocalServerManager } from "../local-server";
import type { McpManager } from "../mcp";
import type { ModelManager } from "../models";
import type { DesktopSandboxManager } from "../sandbox";
import type { ToolRegistry } from "../tools/tool-registry";

/** Process-scoped agent streaming and model-connection controller. */
export class StreamThreadController {
  private readonly _activeStreams = new Map<string, { abort(): void; }>();
  private readonly _approvalAuthorities = new Map<string, {
    readonly key: string;
    readonly resolve: () => Promise<{
      readonly session: StoredRuntimeSession;
      readonly store: SessionStore;
    }>;
    readonly runId: string;
    readonly sessionId: string;
  }>();

  constructor(
    private readonly _modelManager: ModelManager,
    private readonly _analytics: Analytics,
    private readonly _externalAgentProjects?: ExternalAgentProjectManager,
    private readonly _mcpManager?: McpManager,
    private readonly _tools?: ToolRegistry,
    private readonly _localServers?: EmbeddedLocalServerManager,
    private readonly _sandboxes?: DesktopSandboxManager,
    private readonly _localFs?: LocalFileSystem
  ) {}

  registerDesktopThreadApprovals(
    path: string,
    thread: { readonly runtimeSession?: unknown; }
  ): void {
    const session = thread.runtimeSession as StoredRuntimeSession | undefined;
    if (!session) { return; }
    this._registerApprovalAuthorities(
      `desktop:${path}`,
      session,
      async () => {
        if (!this._localFs) {
          throw new Error("Desktop Thread filesystem is unavailable");
        }
        const authority = await createDesktopThreadRuntimeAuthority({
          read: async () => this._localFs!.read(path),
          write: async next => this._localFs!.write(path, next)
        });
        return { session: authority.session, store: authority.sessionStore };
      }
    );
  }

  registerAgentProjectThreadApprovals(
    projectId: string,
    threadId: string,
    thread: { readonly runtimeSession?: unknown; }
  ): void {
    const session = thread.runtimeSession as StoredRuntimeSession | undefined;
    if (!session || !this._externalAgentProjects?.createRuntimeSessionStore) {
      return;
    }
    this._registerApprovalAuthorities(
      `project:${projectId}:${threadId}`,
      session,
      async () => {
        const authority = await this._externalAgentProjects!
          .createRuntimeSessionStore(projectId, threadId);
        if (!authority) {
          throw new Error("Agent Project Thread Runtime Session is unavailable");
        }
        return { session: authority.session, store: authority.sessionStore };
      }
    );
  }

  async decideToolApproval(input: {
    readonly decision: "approved" | "denied";
    readonly requestId: string;
  }): Promise<StoredRuntimeSession> {
    const authority = this._approvalAuthorities.get(input.requestId);
    if (!authority) {
      throw new Error(`Tool approval ${input.requestId} is not registered`);
    }
    const resolved = await authority.resolve();
    const current = await resolved.store.load(authority.sessionId);
    if (!current) {
      throw new Error(`Runtime Session ${authority.sessionId} is unavailable`);
    }
    const principal = {
      issuer: "llm-space-desktop",
      principalId: "local-user",
      principalType: "user" as const
    };
    const committed = await decideRuntimeToolApproval(resolved.store, {
      actor: { current: principal, initiator: principal },
      decision: input.decision,
      expectedVersion: current.version,
      requestId: input.requestId,
      runId: authority.runId,
      sessionId: authority.sessionId
    });
    this._registerApprovalAuthorities(
      authority.key,
      committed,
      authority.resolve
    );
    return committed;
  }

  private _registerApprovalAuthorities(
    key: string,
    session: StoredRuntimeSession,
    resolve: () => Promise<{
      readonly session: StoredRuntimeSession;
      readonly store: SessionStore;
    }>
  ): void {
    for (const [requestId, authority] of this._approvalAuthorities) {
      if (authority.key === key) {
        this._approvalAuthorities.delete(requestId);
      }
    }
    for (const request of session.snapshot.approvalLedger?.requests ?? []) {
      if (request.state !== "pending") { continue; }
      this._approvalAuthorities.set(request.id, {
        key,
        resolve,
        runId: request.runId,
        sessionId: session.snapshot.id
      });
    }
  }

  /** Run an agent stream and push each event back through the caller's sender. */
  async run(
    payload: StreamThreadRequestPayload,
    send: (message: StreamThreadResponsePayload) => void
  ): Promise<void> {
    const { streamId, request } = payload;
    const abortController = new AbortController();
    let aborted = false;
    this._activeStreams.set(streamId, {
      abort() {
        aborted = true;
        abortController.abort();
      }
    });
    const startedAt = Date.now();
    let outcome: "aborted" | "completed" | "error" = "error";
    try {
      if (payload.runtime?.type === "localServerAgentProject") {
        await this._runLocalServer(payload, send, abortController.signal);
      } else if (payload.runtime?.type === "agentProject") {
        await this._runAgentProject(payload, send, () => {
          aborted = true;
        });
      } else if (payload.runtime?.type === "desktopThread") {
        await this._runDesktopThread(payload, send, () => {
          aborted = true;
        });
      } else {
        for await (const event of streamAgent(request, {
          models: await this._modelManager.getAvailableModels(),
          getApiKey: this._modelManager.getApiKey.bind(this._modelManager),
          getBaseUrl: this._modelManager.getBaseUrl.bind(this._modelManager),
          getHeaders: this._modelManager.getHeaders.bind(this._modelManager),
          signal: abortController.signal
        })) {
          send({ streamId, type: "event", event });
        }
      }
      if (aborted) {
        outcome = "aborted";
        return;
      }
      outcome = "completed";
      send({ streamId, type: "done" });
    } catch (error) {
      if (error instanceof DurableOperationOutcomeUnknownError) {
        send({
          streamId,
          type: "error",
          message: error.message,
          code: "outcomeUnknown"
        });
      } else if (aborted || abortController.signal.aborted) {
        outcome = "aborted";
        return;
      } else {
        send({
          streamId,
          type: "error",
          message: error instanceof Error ? error.message : "Internal error",
          ...(error instanceof AgentStateCommitUnknownError
            ? { code: "outcomeUnknown" as const }
            : error instanceof RuntimeToolApprovalStaleError
              ? { code: error.code }
              : error instanceof AgentHostPolicyChangedError
                ? { code: "hostPolicyChanged" as const }
                : error instanceof ExecutionEnvUnavailableError
                  ? { code: "executionEnvUnavailable" as const }
                  : error instanceof SandboxWorkspaceLostError
                    ? { code: "sandboxWorkspaceLost" as const }
                    : error instanceof SandboxUnavailableError
                      ? { code: "sandboxUnavailable" as const }
                      : error instanceof StructuredOutputError
                        ? { code: error.code }
                        : {})
        });
      }
    } finally {
      this._activeStreams.delete(streamId);
      this._analytics.capture("thread_run", {
        ...this._scrubModelForTelemetry(request.model),
        outcome,
        durationMs: Date.now() - startedAt,
        messageCount: request.context.messages.length,
        toolCount: request.context.tools.length,
        hasSystemPrompt: Boolean(request.context.systemPrompt)
      });
    }
  }

  private async _runLocalServer(
    payload: StreamThreadRequestPayload,
    send: (message: StreamThreadResponsePayload) => void,
    signal: AbortSignal
  ): Promise<void> {
    if (
      payload.runtime?.type !== "localServerAgentProject"
      || !this._localServers
    ) {
      throw new Error("Local Server runtime is unavailable.");
    }
    const text = _localServerText(payload.request.context.messages.at(-1));
    let structuredOutputFailure:
      | "structured_output_invalid"
      | "structured_output_missing"
      | "structured_output_too_large"
      | undefined;
    let executionEnvUnavailable = false;
    let sandboxFailure: "sandboxUnavailable" | "sandboxWorkspaceLost" | undefined;
    await this._localServers.run(
      {
        projectId: payload.runtime.projectId,
        threadId: payload.runtime.threadId,
        signal,
        text,
        ...(payload.request.outputContract
          ? { outputContract: payload.request.outputContract }
          : {})
      },
      {
        onEvent: event => {
          send({ streamId: payload.streamId, type: "event", event });
        },
        onLineage: lineage => {
          send({
            streamId: payload.streamId,
            type: "localServerLineage",
            lineage
          });
        },
        onStatus: status => {
          send({
            streamId: payload.streamId,
            type: "localServerStatus",
            status
          });
        },
        onTerminal: (lineage, terminalOutcome, code) => {
          send({
            streamId: payload.streamId,
            type: "localServerLineage",
            lineage,
            terminalOutcome
          });
          if (
            code === "structured_output_invalid"
            || code === "structured_output_missing"
            || code === "structured_output_too_large"
          ) {
            structuredOutputFailure = code;
          } else if (code === "executionEnvUnavailable") {
            executionEnvUnavailable = true;
          } else if (
            code === "sandboxUnavailable"
            || code === "sandboxWorkspaceLost"
          ) {
            sandboxFailure = code;
          }
        }
      }
    );
    if (structuredOutputFailure) {
      throw new StructuredOutputError(
        structuredOutputFailure,
        "The selected structured output did not complete"
      );
    }
    if (executionEnvUnavailable) {
      throw new ExecutionEnvUnavailableError();
    }
    if (sandboxFailure === "sandboxWorkspaceLost") {
      throw new SandboxWorkspaceLostError();
    }
    if (sandboxFailure === "sandboxUnavailable") {
      throw new SandboxUnavailableError();
    }
  }

  private async _runDesktopThread(
    payload: StreamThreadRequestPayload,
    send: (message: StreamThreadResponsePayload) => void,
    onAbort: () => void
  ): Promise<void> {
    if (payload.runtime?.type !== "desktopThread") {
      throw new Error("Desktop Thread runtime is unavailable.");
    }
    const threadPath = payload.runtime.threadPath;
    const sourceTools = payload.request.context.sourceTools ?? [];
    const extraTools = sourceTools
      .filter(tool => tool.type !== "project")
      .map(tool => ({
        ...this._runtimeTool(tool),
        provenance: { contributionId: `host-tool:${tool.name}` }
      }));
    extraTools.push(
      ...sourceTools
        .filter((tool): tool is ProjectTool => tool.type === "project")
        .map(tool => ({
          kind: "deferred" as const,
          definition: {
            name: tool.name,
            label: tool.name,
            description: tool.description,
            parameters: tool.parameters
          },
          provenance: {
            contributionId: `host-tool:${tool.name}`,
            ...(tool.sourcePath ? { sourcePath: tool.sourcePath } : {})
          }
        }))
    );
    const project: AgentProjectSnapshot = {
      root: "desktop-thread://runtime",
      definition: {
        model: payload.request.model,
        modelOptions: {
          ...(payload.request.config?.model?.maxTokens === undefined
            ? {}
            : { maxTokens: payload.request.config.model.maxTokens }),
          ...(payload.request.config?.model?.temperature === undefined
            ? {}
            : { temperature: payload.request.config.model.temperature })
        },
        reasoning: payload.request.config?.model?.reasoning
      },
      instructions: "",
      tools: [],
      connections: [],
      resources: {},
      diagnostics: [],
      fingerprint: "desktop-thread-runtime-v1"
    };
    const models = await this._modelManager.getAvailableModels();
    const runtimeState = threadPath && this._localFs
      ? await createDesktopThreadRuntimeAuthority({
        read: async () => this._localFs!.read(threadPath),
        write: async thread => this._localFs!.write(
          threadPath,
          thread
        )
      })
      : null;
    const activeRunId = runtimeState?.session.snapshot.activeRunId;
    const turnSequence = runtimeState?.session.snapshot.runs.findIndex(
      run => run.id === activeRunId
    ) ?? -1;
    if (runtimeState && (!activeRunId || turnSequence < 0)) {
      throw new Error("Desktop Thread has no active Runtime Run.");
    }
    const runtime = new AgentRuntime({
      models,
      project
    });
    const desktopPrincipal = {
      issuer: "llm-space-desktop",
      principalId: "local-user",
      principalType: "user" as const
    };
    const session = await runtime.createSession({
      capabilityPolicy: createHostCapabilityPolicy({
        extraTools,
        models,
        project
      }),
      id: runtimeState?.session.snapshot.id ?? payload.streamId,
      context: {
        id: runtimeState?.session.snapshot.id ?? payload.streamId,
        auth: {
          initiator: desktopPrincipal,
          current: desktopPrincipal
        },
        channel: { kind: "desktop" },
        turn: {
          id: activeRunId ?? payload.streamId,
          sequence: turnSequence >= 0 ? turnSequence + 1 : 1
        }
      },
      model: payload.request.model,
      modelOptions: {
        ...(payload.request.config?.model?.maxTokens === undefined
          ? {}
          : { maxTokens: payload.request.config.model.maxTokens }),
        ...(payload.request.config?.model?.temperature === undefined
          ? {}
          : { temperature: payload.request.config.model.temperature })
      },
      reasoning: payload.request.config?.model?.reasoning,
      initialMessages: runtimeState
        ? runtimeState.reconcileInitialMessages(
          payload.request.context.messages as AgentMessage[]
        )
        : payload.request.context.messages as AgentMessage[],
      extraTools,
      activeToolNames: sourceTools.map(tool => tool.name),
      systemPrompt: payload.request.context.systemPrompt,
      executionMode: payload.runtime.executionMode,
      streamFn: this._streamFn(payload),
      ...(runtimeState && activeRunId
        ? {
          sessionStore: runtimeState.sessionStore,
          persistence: runtimeState.persistence,
          onSessionCommitted: (runtimeSession: StoredRuntimeSession) => {
            if (threadPath) {
              this.registerDesktopThreadApprovals(threadPath, {
                runtimeSession
              });
            }
            send({
              streamId: payload.streamId,
              type: "runtimeSession",
              runtimeSession
            });
          }
        }
        : {})
    });
    const resumesApproval = runtimeState && activeRunId
      ? runtimeRunHasParkedToolApprovals(runtimeState.session, activeRunId)
      : false;
    await this._streamSession(
      payload.streamId,
      session,
      send,
      onAbort,
      resumesApproval
        ? async () => session.resumeApprovedTools()
        : async () => session.continue()
    );
  }

  private async _runAgentProject(
    payload: StreamThreadRequestPayload,
    send: (message: StreamThreadResponsePayload) => void,
    onAbort: () => void
  ): Promise<void> {
    if (
      payload.runtime?.type !== "agentProject"
      || !this._externalAgentProjects
    ) {
      throw new Error("Agent Project runtime is unavailable.");
    }
    const runtimePayload = payload.runtime;
    const sourceTools = payload.request.context.sourceTools ?? [];
    const projectSnapshot = sourceTools.find(
      (tool): tool is ProjectTool => tool.type === "project"
    )?.snapshot;
    const activeRemoteToolNames =
      projectSnapshot === undefined
        ? new Set<string>()
        : this._externalAgentProjects.getActiveRemoteToolNames(
          payload.runtime.projectId,
          payload.runtime.threadId,
          projectSnapshot
        );
    const unavailableRemoteTool = sourceTools.find(
      (tool): tool is ProjectTool =>
        tool.type === "project"
        && Boolean(tool.connectionName)
        && !activeRemoteToolNames.has(tool.name)
    );
    if (unavailableRemoteTool) {
      throw new Error(
        `Selected connection tool is unavailable: ${unavailableRemoteTool.name}`
      );
    }
    const activeSourceTools = sourceTools;
    const extraTools = activeSourceTools
      .filter(tool => tool.type !== "project")
      .map(tool => ({
        ...this._runtimeTool(tool),
        provenance: { contributionId: `host-tool:${tool.name}` }
      }));
    extraTools.push(
      ...activeSourceTools
        .filter(
          (tool): tool is ProjectTool =>
            tool.type === "project" && Boolean(tool.connectionName)
        )
        .map(tool => ({
          kind: "deferred" as const,
          definition: {
            name: tool.name,
            label: tool.name,
            description: tool.description,
            parameters: tool.parameters
          },
          provenance: {
            connectionName: tool.connectionName,
            contributionId: `connection:${tool.sourcePath ?? tool.connectionName}`,
            ...(tool.schemaFingerprint
              ? { schemaFingerprint: tool.schemaFingerprint }
              : {}),
            ...(tool.sourcePath ? { sourcePath: tool.sourcePath } : {})
          }
        }))
    );
    const createRuntimeSessionStore = this._externalAgentProjects
      .createRuntimeSessionStore?.bind(this._externalAgentProjects);
    const runtimeState = createRuntimeSessionStore
      ? await createRuntimeSessionStore(
        payload.runtime.projectId,
        payload.runtime.threadId
      )
      : null;
    const activeRunId = runtimeState?.session.snapshot.activeRunId;
    const turnSequence = runtimeState?.session.snapshot.runs.findIndex(
      run => run.id === activeRunId
    ) ?? -1;
    if (runtimeState && (!activeRunId || turnSequence < 0)) {
      throw new Error("Project Thread has no active Runtime Run.");
    }
    const desktopPrincipal = {
      issuer: "llm-space-desktop",
      principalId: "local-user",
      principalType: "user" as const
    };
    const sessionId = runtimeState?.session.snapshot.id
      ?? payload.runtime.threadId;
    const sandboxSessionId = payload.runtime.threadId;
    const threadRecord = await this._externalAgentProjects.readThread(
      payload.runtime.projectId,
      payload.runtime.threadId
    );
    const profile = threadRecord.thread.runtimeProfile?.type
      ?? "desktopDirect";
    if (profile === "desktopSandbox") {
      await this._sandboxes?.reconcileAttachmentStaging(
        sandboxSessionId,
        threadRecord.thread.sandboxAttachments ?? {}
      );
      await this._externalAgentProjects.lockSandboxAttachments(
        payload.runtime.projectId,
        payload.runtime.threadId,
        payload.runtime.sandboxAttachmentMessageIds
      );
    }
    const sandbox = profile === "desktopSandbox"
      ? await this._prepareSandboxTurn({
        projectId: payload.runtime.projectId,
        sessionId: sandboxSessionId,
        snapshot: threadRecord.thread.agentRuntime?.snapshot,
        turnId: activeRunId ?? payload.streamId
      })
      : undefined;
    const publishRuntimeSession = (runtimeSession: StoredRuntimeSession) => {
      this.registerAgentProjectThreadApprovals(
        runtimePayload.projectId,
        runtimePayload.threadId,
        { runtimeSession }
      );
      send({
        streamId: payload.streamId,
        type: "runtimeSession",
        runtimeSession
      });
    };
    const session = await this._externalAgentProjects.createRuntimeSession(
      payload.runtime.projectId,
      {
        id: sessionId,
        context: {
          id: sessionId,
          auth: {
            initiator: desktopPrincipal,
            current: desktopPrincipal
          },
          channel: { kind: "desktop", id: payload.runtime.threadId },
          turn: {
            id: activeRunId ?? payload.streamId,
            sequence: turnSequence >= 0 ? turnSequence + 1 : 1
          }
        },
        ...(runtimeState && activeRunId
          ? {
            sessionStore: runtimeState.sessionStore,
            persistence: runtimeState.persistence,
            onSessionCommitted: publishRuntimeSession
          }
          : {}),
        ...(payload.runtime.modelSource === "threadOverride"
          ? {
            model: payload.request.model,
            modelConfigurationAuthority: "host" as const
          }
          : {}),
        ...(payload.runtime.modelSource === "threadOverride"
          ? {
            modelOptions: {
              ...(payload.request.config?.model?.maxTokens === undefined
                ? {}
                : { maxTokens: payload.request.config.model.maxTokens }),
              ...(payload.request.config?.model?.temperature === undefined
                ? {}
                : { temperature: payload.request.config.model.temperature })
            },
            ...(payload.request.config?.model?.reasoning === undefined
              ? {}
              : { reasoning: payload.request.config.model.reasoning })
          }
          : {}),
        initialMessages: runtimeState
          ? runtimeState.reconcileInitialMessages(
            payload.request.context.messages as AgentMessage[]
          )
          : payload.request.context.messages as AgentMessage[],
        ...(payload.request.outputContract
          ? { outputContract: payload.request.outputContract }
          : {}),
        extraTools,
        activeToolNames: activeSourceTools.map(tool => tool.name),
        systemPrompt: payload.request.context.systemPrompt,
        executionMode: payload.runtime.executionMode,
        streamFn: this._streamFn(payload),
        ...(sandbox ? { sandbox } : {})
      }
    );
    const definition = session.project.definition;
    if (!definition) { throw new Error("Agent runtime definition is unavailable."); }
    const matchesDefinition = agentModelMatchesDefinition({
      model: session.model,
      reasoning: session.reasoning,
      definition
    });
    send({
      streamId: payload.streamId,
      type: "runtime",
      runtime: {
        projectId: payload.runtime.projectId,
        snapshot: session.project.fingerprint,
        definitionFingerprint: agentDefinitionFingerprint(definition),
        modelSource:
          payload.runtime.modelSource === "threadOverride" || !matchesDefinition
            ? "threadOverride"
            : "agent"
      }
    });
    const resumesApproval = runtimeState && activeRunId
      ? runtimeRunHasParkedToolApprovals(runtimeState.session, activeRunId)
      : false;
    await this._streamSession(
      payload.streamId,
      session,
      send,
      onAbort,
      resumesApproval
        ? async () => session.resumeApprovedTools()
        : async () => session.continue()
    );
  }

  private async _prepareSandboxTurn(input: {
    projectId: string;
    sessionId: string;
    snapshot?: string;
    turnId: string;
  }) {
    if (!this._sandboxes) { throw new SandboxUnavailableError(); }
    const project = input.snapshot
      ? await this._externalAgentProjects!.getCompiledProject(
        input.projectId,
        input.snapshot
      )
      : null;
    if (!project) { throw new SandboxUnavailableError(); }
    return this._sandboxes.prepareTurn({
      sessionId: input.sessionId,
      turnId: input.turnId,
      seed: project.sandbox?.workspace ?? []
    });
  }

  private async _streamSession(
    streamId: string,
    session: AgentSession,
    send: (message: StreamThreadResponsePayload) => void,
    onAbort: () => void,
    execute: () => Promise<void> = async () => session.continue()
  ): Promise<void> {
    this._activeStreams.set(streamId, {
      abort() {
        onAbort();
        session.abort();
      }
    });
    const unsubscribe = session.subscribe(event => {
      if (event.type !== "tool_calls_deferred") {
        send({ streamId, type: "event", event });
      }
    });
    try {
      await execute();
    } finally {
      unsubscribe();
    }
  }

  private _streamFn(payload: StreamThreadRequestPayload): StreamFn {
    return async (model, context, options) => {
      const models = await this._modelManager.getAvailableModels();
      const baseUrl = this._modelManager.getBaseUrl(model.provider);
      const headers = this._modelManager.getHeaders(model.provider);
      const config = payload.request.config?.model;
      return models.streamSimple(
        baseUrl ? { ...model, baseUrl } : model,
        context,
        {
          ...options,
          ...(config?.maxTokens === undefined
            ? {}
            : { maxTokens: config.maxTokens }),
          ...(config?.temperature === undefined
            ? {}
            : { temperature: config.temperature }),
          ...(headers
            ? { headers: { ...headers, ...options?.headers } }
            : {})
        }
      );
    };
  }

  private _runtimeTool(
    tool: Exclude<Tool, { type: "project"; }>
  ): PreparedAgentTool {
    const definition = {
      name: tool.name,
      label: tool.name,
      description: tool.description,
      parameters: tool.parameters
    } satisfies PreparedAgentTool["definition"];
    if (tool.type === "function" || _requiresHumanResult(tool)) {
      return { kind: "deferred", definition };
    }
    if (tool.type === "mcp") {
      if (!this._mcpManager) {
        throw new Error("MCP runtime is unavailable.");
      }
      return {
        kind: "executable",
        definition,
        execute: async (_toolCallId, args) => {
          const result = await this._mcpManager!.callTool({
            serverId: tool.serverId,
            toolName: tool.toolName,
            arguments: args as Record<string, unknown>
          });
          if (result.isError) {
            throw new Error(
              result.contentText || `MCP tool ${tool.toolName} failed`
            );
          }
          return {
            type: "completed",
            result: {
              content: [{ type: "text", text: result.contentText }],
              details: undefined
            }
          };
        }
      };
    }
    if (!this._tools) {
      throw new Error("Built-in tool runtime is unavailable.");
    }
    return {
      kind: "executable",
      definition,
      execute: async (_toolCallId, args) => {
        const command =
          tool.name === "bash"
          && args
          && typeof args === "object"
          && "command" in args
            ? args.command
            : undefined;
        if (typeof command === "string" && isDangerousBashCommand(command)) {
          return { type: "deferred" };
        }
        const result = await this._tools!.call({
          name: tool.name,
          arguments: args as Record<string, unknown>
        });
        return {
          type: "completed",
          result: {
            content: [{ type: "text", text: result.contentText }],
            details: undefined
          }
        };
      }
    };
  }

  /** Abort one in-flight stream. */
  abort({ streamId }: AbortStreamThreadPayload): void {
    this._activeStreams.get(streamId)?.abort();
  }

  /** Abort every in-flight stream during application shutdown. */
  shutdown(): void {
    for (const controller of this._activeStreams.values()) {
      controller.abort();
    }
    this._activeStreams.clear();
  }

  /** Verify a provider with a minimal completion through the normal agent path. */
  async testModelConnection({
    providerId,
    modelId,
    candidate
  }: {
    candidate?: CustomModel;
    modelId: string;
    providerId: string;
  }): Promise<void> {
    const models = candidate
      ? this._modelManager.buildModelsWithCandidate(providerId, candidate)
      : await this._modelManager.getAvailableModels();
    const targetId = candidate?.id ?? modelId;
    const abortController = new AbortController();
    try {
      for await (const event of streamAgent(
        {
          model: { provider: providerId, id: targetId },
          context: {
            systemPrompt: "You are a connection tester.",
            messages: [
              {
                role: "user",
                content: [{ type: "text", text: 'Reply with "ok".' }],
                timestamp: Date.now()
              }
            ],
            tools: []
          }
        },
        {
          models,
          getApiKey: this._modelManager.getApiKey.bind(this._modelManager),
          getBaseUrl: this._modelManager.getBaseUrl.bind(this._modelManager),
          getHeaders: this._modelManager.getHeaders.bind(this._modelManager),
          signal: abortController.signal
        }
      )) {
        if (event.type === "agent_end") {
          for (const message of event.messages) {
            if (message.role === "assistant" && message.errorMessage) {
              throw new Error(message.errorMessage);
            }
          }
        }
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        detail.trim()
        || `Could not reach ${providerId}/${targetId}. Check the Base URL and API key.`,
        { cause: error }
      );
    }
  }

  private _scrubModelForTelemetry(model: { id: string; provider: string; }): {
    model: string;
    provider: string;
  } {
    return {
      provider: this._modelManager.isBuiltin(model.provider)
        ? model.provider
        : "custom",
      model: this._modelManager.isBuiltinCatalogModel(model.provider, model.id)
        ? model.id
        : "custom"
    };
  }
}

function _localServerText(message: AgentMessage | undefined): string {
  if (message?.role !== "user") {
    throw new Error("Local Server requires one trailing user text message.");
  }
  if (typeof message.content === "string") {
    if (!message.content.trim()) {
      throw new Error("Local Server user text cannot be empty.");
    }
    return message.content;
  }
  if (
    !Array.isArray(message.content)
    || message.content.length !== 1
    || message.content[0]?.type !== "text"
    || !message.content[0].text.trim()
  ) {
    throw new Error("Local Server accepts one pure-text user Turn only.");
  }
  return message.content[0].text;
}

function _requiresHumanResult(tool: BuiltinTool | McpTool): boolean {
  return tool.type === "builtin" && tool.terminate === true;
}
