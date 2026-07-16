import {
  type BuiltinTool,
  type CustomModel,
  isDangerousBashCommand,
  type McpTool,
  type ProjectTool,
  type Tool
} from "@llm-space/core";
import { streamAgent } from "@llm-space/core/server";
import { agentModelMatchesDefinition } from "@llm-space/runtime";
import {
  type AgentProjectSnapshot,
  AgentRuntime,
  type AgentSession,
  type PreparedAgentTool
} from "@llm-space/runtime/node";

import type {
  AgentMessage,
  StreamFn
} from "@earendil-works/pi-agent-core";

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
import type { ToolRegistry } from "../tools/tool-registry";

/** Process-scoped agent streaming and model-connection controller. */
export class StreamThreadController {
  private readonly _activeStreams = new Map<string, { abort(): void; }>();

  constructor(
    private readonly _modelManager: ModelManager,
    private readonly _analytics: Analytics,
    private readonly _externalAgentProjects?: ExternalAgentProjectManager,
    private readonly _mcpManager?: McpManager,
    private readonly _tools?: ToolRegistry,
    private readonly _localServers?: EmbeddedLocalServerManager
  ) {}

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
      if (aborted || abortController.signal.aborted) {
        outcome = "aborted";
        return;
      }
      send({
        streamId,
        type: "error",
        message: error instanceof Error ? error.message : "Internal error"
      });
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
    await this._localServers.run(
      {
        projectId: payload.runtime.projectId,
        threadId: payload.runtime.threadId,
        signal,
        text
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
        onTerminal: (lineage, terminalOutcome) => {
          send({
            streamId: payload.streamId,
            type: "localServerLineage",
            lineage,
            terminalOutcome
          });
        }
      }
    );
  }

  private async _runDesktopThread(
    payload: StreamThreadRequestPayload,
    send: (message: StreamThreadResponsePayload) => void,
    onAbort: () => void
  ): Promise<void> {
    if (payload.runtime?.type !== "desktopThread") {
      throw new Error("Desktop Thread runtime is unavailable.");
    }
    const sourceTools = payload.request.context.sourceTools ?? [];
    const extraTools = sourceTools
      .filter(tool => tool.type !== "project")
      .map(tool => this._runtimeTool(tool));
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
          }
        }))
    );
    const project: AgentProjectSnapshot = {
      root: "desktop-thread://runtime",
      definition: {
        model: payload.request.model,
        reasoning: payload.request.config?.model?.reasoning
      },
      instructions: "",
      tools: [],
      connections: [],
      resources: {},
      diagnostics: [],
      fingerprint: "desktop-thread-runtime-v1"
    };
    const runtime = new AgentRuntime({
      models: await this._modelManager.getAvailableModels(),
      project
    });
    const session = await runtime.createSession({
      id: payload.streamId,
      model: payload.request.model,
      reasoning: payload.request.config?.model?.reasoning,
      initialMessages: payload.request.context.messages as AgentMessage[],
      extraTools,
      activeToolNames: sourceTools.map(tool => tool.name),
      systemPrompt: payload.request.context.systemPrompt,
      executionMode: payload.runtime.executionMode,
      streamFn: this._streamFn(payload)
    });
    await this._streamSession(payload.streamId, session, send, onAbort);
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
    const activeSourceTools = sourceTools.filter(
      tool =>
        tool.type !== "project"
        || !tool.connectionName
        || activeRemoteToolNames.has(tool.name)
    );
    const extraTools = activeSourceTools
      .filter(tool => tool.type !== "project")
      .map(tool => this._runtimeTool(tool));
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
          }
        }))
    );
    const session = await this._externalAgentProjects.createRuntimeSession(
      payload.runtime.projectId,
      {
        id: payload.runtime.threadId,
        model: payload.request.model,
        reasoning: payload.request.config?.model?.reasoning,
        initialMessages: payload.request.context.messages as AgentMessage[],
        extraTools,
        activeToolNames: activeSourceTools.map(tool => tool.name),
        systemPrompt: payload.request.context.systemPrompt,
        executionMode: payload.runtime.executionMode,
        streamFn: this._streamFn(payload)
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
    await this._streamSession(payload.streamId, session, send, onAbort);
  }

  private async _streamSession(
    streamId: string,
    session: AgentSession,
    send: (message: StreamThreadResponsePayload) => void,
    onAbort: () => void
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
      await session.continue();
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
