import { createHash } from "node:crypto";

import type { AgentMessage, AgentTool } from "@earendil-works/pi-agent-core";
import type { BuiltinTool, CustomModel, McpTool, Tool } from "@llm-space/core";
import { streamAgent } from "@llm-space/core/server";
import { createDeferredAgentTool } from "@llm-space/runtime";

import type {
  AbortStreamThreadPayload,
  StreamThreadRequestPayload,
  StreamThreadResponsePayload,
} from "../../shared/rpc";
import type { Analytics } from "../analytics";
import type { ExternalAgentProjectManager } from "../external-projects";
import type { McpManager } from "../mcp";
import type { ModelManager } from "../models";
import type { ToolRegistry } from "../tools/tool-registry";

/** Process-scoped agent streaming and model-connection controller. */
export class StreamThreadController {
  private readonly _activeStreams = new Map<string, { abort(): void }>();

  constructor(
    private readonly _modelManager: ModelManager,
    private readonly _analytics: Analytics,
    private readonly _externalAgentProjects?: ExternalAgentProjectManager,
    private readonly _mcpManager?: McpManager,
    private readonly _tools?: ToolRegistry
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
      },
    });
    const startedAt = Date.now();
    let outcome: "completed" | "error" | "aborted" = "error";
    try {
      if (payload.runtime?.type === "agentProject") {
        await this._runAgentProject(payload, send, () => {
          aborted = true;
        });
      } else {
        for await (const event of streamAgent(request, {
          models: await this._modelManager.getAvailableModels(),
          getApiKey: this._modelManager.getApiKey.bind(this._modelManager),
          getBaseUrl: this._modelManager.getBaseUrl.bind(this._modelManager),
          getHeaders: this._modelManager.getHeaders.bind(this._modelManager),
          signal: abortController.signal,
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
        message: error instanceof Error ? error.message : "Internal error",
      });
    } finally {
      this._activeStreams.delete(streamId);
      this._analytics.capture("thread_run", {
        ...this._scrubModelForTelemetry(request.model),
        outcome,
        durationMs: Date.now() - startedAt,
        messageCount: request.context.messages.length,
        toolCount: request.context.tools.length,
        hasSystemPrompt: Boolean(request.context.systemPrompt),
      });
    }
  }

  private async _runAgentProject(
    payload: StreamThreadRequestPayload,
    send: (message: StreamThreadResponsePayload) => void,
    onAbort: () => void
  ): Promise<void> {
    if (!payload.runtime || !this._externalAgentProjects) {
      throw new Error("Agent Project runtime is unavailable.");
    }
    const sourceTools = payload.request.context.sourceTools ?? [];
    const extraTools = sourceTools
      .filter((tool) => tool.type !== "project")
      .map((tool) => this._runtimeTool(tool));
    const session = await this._externalAgentProjects.createRuntimeSession(
      payload.runtime.projectId,
      {
        id: payload.runtime.threadId,
        model: payload.request.model,
        reasoning: payload.request.config?.model?.reasoning,
        initialMessages: payload.request.context.messages as AgentMessage[],
        extraTools,
        activeToolNames: sourceTools.map((tool) => tool.name),
        systemPrompt: payload.request.context.systemPrompt,
        executionMode: payload.runtime.executionMode,
        streamFn: async (model, context, options) => {
          const models = await this._modelManager.getAvailableModels();
          const baseUrl = this._modelManager.getBaseUrl(model.provider);
          const headers = this._modelManager.getHeaders(model.provider);
          return models.streamSimple(
            baseUrl ? { ...model, baseUrl } : model,
            context,
            headers
              ? {
                  ...options,
                  headers: { ...headers, ...options?.headers },
                }
              : options
          );
        },
      }
    );
    const definition = session.project.definition;
    if (!definition)
      throw new Error("Agent runtime definition is unavailable.");
    const matchesDefinition =
      session.model.provider === definition.model.provider &&
      session.model.id === definition.model.id &&
      session.reasoning === definition.reasoning;
    send({
      streamId: payload.streamId,
      type: "runtime",
      runtime: {
        projectId: payload.runtime.projectId,
        snapshot: session.project.fingerprint,
        definitionFingerprint: createHash("sha256")
          .update(JSON.stringify(definition))
          .digest("hex"),
        modelSource:
          payload.runtime.modelSource === "threadOverride" || !matchesDefinition
            ? "threadOverride"
            : "agent",
      },
    });
    this._activeStreams.set(payload.streamId, {
      abort() {
        onAbort();
        session.abort();
      },
    });
    const unsubscribe = session.subscribe((event) => {
      if (event.type !== "tool_calls_deferred") {
        send({
          streamId: payload.streamId,
          type: "event",
          event,
        });
      }
    });
    try {
      await session.continue();
    } finally {
      unsubscribe();
    }
  }

  private _runtimeTool(tool: Exclude<Tool, { type: "project" }>): AgentTool {
    const definition = {
      name: tool.name,
      label: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    } as Omit<AgentTool, "execute">;
    if (tool.type === "function" || _requiresHumanResult(tool)) {
      return createDeferredAgentTool(definition);
    }
    if (tool.type === "mcp") {
      if (!this._mcpManager) {
        throw new Error("MCP runtime is unavailable.");
      }
      return {
        ...definition,
        execute: async (_toolCallId, args) => {
          const result = await this._mcpManager!.callTool({
            serverId: tool.serverId,
            toolName: tool.toolName,
            arguments: args as Record<string, unknown>,
          });
          return {
            content: [{ type: "text", text: result.contentText }],
            details: undefined,
          };
        },
      } as AgentTool;
    }
    if (!this._tools) {
      throw new Error("Built-in tool runtime is unavailable.");
    }
    return {
      ...definition,
      execute: async (_toolCallId, args) => {
        const result = await this._tools!.call({
          name: tool.name,
          arguments: args as Record<string, unknown>,
        });
        return {
          content: [{ type: "text", text: result.contentText }],
          details: undefined,
        };
      },
    } as AgentTool;
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
    candidate,
  }: {
    providerId: string;
    modelId: string;
    candidate?: CustomModel;
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
                timestamp: Date.now(),
              },
            ],
            tools: [],
          },
        },
        {
          models,
          getApiKey: this._modelManager.getApiKey.bind(this._modelManager),
          getBaseUrl: this._modelManager.getBaseUrl.bind(this._modelManager),
          getHeaders: this._modelManager.getHeaders.bind(this._modelManager),
          signal: abortController.signal,
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
        detail.trim() ||
          `Could not reach ${providerId}/${targetId}. Check the Base URL and API key.`,
        { cause: error }
      );
    }
  }

  private _scrubModelForTelemetry(model: { provider: string; id: string }): {
    provider: string;
    model: string;
  } {
    return {
      provider: this._modelManager.isBuiltin(model.provider)
        ? model.provider
        : "custom",
      model: this._modelManager.isBuiltinCatalogModel(model.provider, model.id)
        ? model.id
        : "custom",
    };
  }
}

function _requiresHumanResult(tool: BuiltinTool | McpTool): boolean {
  return tool.type === "builtin" && tool.terminate === true;
}
