import {
  Agent,
  type AgentEvent,
  type AgentMessage,
  type AgentTool,
  type StreamFn,
  type ThinkingLevel,
} from "@earendil-works/pi-agent-core";
import type {
  Api,
  Model,
  Models,
  ToolResultMessage,
} from "@earendil-works/pi-ai";

import type { AgentModelSelector } from "./agent-definition";
import type { AgentProjectSnapshot } from "./project";

export type RuntimeExecutionMode = "manual" | "autoOnce" | "react";

export interface DeferredToolCall {
  id: string;
  name: string;
  arguments: unknown;
}

export type AgentRuntimeSessionEvent =
  AgentEvent | { type: "tool_calls_deferred"; calls: DeferredToolCall[] };

export interface AgentRuntimeSessionPersistence {
  replaceMessages(messages: AgentMessage[]): Promise<void> | void;
}

export interface AgentRuntimeSessionOptions {
  id?: string;
  models: Models;
  project: AgentProjectSnapshot;
  model: Model<Api>;
  modelSelector: AgentModelSelector;
  reasoning?: ThinkingLevel;
  initialMessages: AgentMessage[];
  extraTools: AgentTool[];
  activeToolNames?: string[];
  instructionsPrefix: string;
  systemPrompt?: string;
  executionMode: RuntimeExecutionMode;
  persistence?: AgentRuntimeSessionPersistence;
  streamFn?: StreamFn;
}

const DEFERRED_MARKER = "llm-space-runtime-deferred";
const RUNTIME_DEFERRED_TOOL = Symbol("llm-space-runtime-deferred-tool");

type RuntimeDeferredAgentTool = AgentTool & {
  [RUNTIME_DEFERRED_TOOL]: true;
};

export function createDeferredAgentTool(
  tool: Omit<AgentTool, "execute">
): AgentTool {
  return {
    ...tool,
    [RUNTIME_DEFERRED_TOOL]: true,
    execute() {
      return Promise.resolve({
        content: [{ type: "text", text: "" }],
        details: { marker: DEFERRED_MARKER },
        terminate: true,
      });
    },
  } as RuntimeDeferredAgentTool;
}

export class AgentRuntimeSession {
  private readonly _agent: Agent;
  private readonly _listeners = new Set<
    (event: AgentRuntimeSessionEvent) => Promise<void> | void
  >();
  private readonly _models: Models;
  private readonly _project: AgentProjectSnapshot;
  private readonly _modelSelector: AgentModelSelector;
  private readonly _reasoning?: ThinkingLevel;
  private readonly _tools: AgentTool[];
  private readonly _deferredToolNames: Set<string>;
  private readonly _persistence?: AgentRuntimeSessionPersistence;
  private readonly _deferredCalls = new Map<string, DeferredToolCall>();
  private readonly _toolArguments = new Map<string, unknown>();
  private _executionMode: RuntimeExecutionMode;

  constructor(options: AgentRuntimeSessionOptions) {
    this._models = options.models;
    this._project = options.project;
    this._modelSelector = options.modelSelector;
    this._reasoning = options.reasoning;
    const allTools = _uniqueTools([
      ...options.project.tools,
      ...options.extraTools,
    ]);
    const activeToolNames = options.activeToolNames
      ? new Set(options.activeToolNames)
      : null;
    this._tools = activeToolNames
      ? allTools.filter((tool) => activeToolNames.has(tool.name))
      : allTools;
    this._deferredToolNames = new Set(
      this._tools.filter(_isRuntimeDeferredTool).map((tool) => tool.name)
    );
    this._executionMode = options.executionMode;
    this._persistence = options.persistence;
    this._agent = new Agent({
      sessionId: options.id,
      initialState: {
        systemPrompt:
          options.systemPrompt ??
          _systemPrompt(options.project, options.instructionsPrefix),
        model: options.model,
        thinkingLevel: options.reasoning ?? "off",
        messages: _restoreDeferredPlaceholders(
          options.initialMessages,
          options.executionMode
        ),
        tools: this._toolsForMode(options.executionMode),
      },
      streamFn:
        options.streamFn ??
        ((model, context, streamOptions) =>
          this._models.streamSimple(model, context, streamOptions)),
    });
    this._agent.subscribe((event) => this._handleAgentEvent(event));
  }

  get project(): AgentProjectSnapshot {
    return this._project;
  }

  get model(): AgentModelSelector {
    return this._modelSelector;
  }

  get reasoning(): ThinkingLevel | undefined {
    return this._reasoning;
  }

  get executionMode(): RuntimeExecutionMode {
    return this._executionMode;
  }

  get messages(): AgentMessage[] {
    return _publicMessages(this._agent.state.messages);
  }

  setExecutionMode(mode: RuntimeExecutionMode): void {
    if (this._agent.state.isStreaming) {
      throw new Error(
        "Cannot change execution mode while the session is running"
      );
    }
    this._executionMode = mode;
    this._agent.state.tools = this._toolsForMode(mode);
  }

  prompt(message: AgentMessage | AgentMessage[] | string): Promise<void> {
    return this._agent.prompt(message as AgentMessage | AgentMessage[]);
  }

  async resolveToolResults(results: ToolResultMessage[]): Promise<void> {
    if (this._agent.state.isStreaming) {
      throw new Error(
        "Cannot resolve tool results while the session is running"
      );
    }
    const replacements = new Map(
      results.map((result) => [result.toolCallId, result])
    );
    const pending = this._agent.state.messages.filter(_isDeferredResult);
    if (
      pending.length === 0 ||
      pending.some((message) => !replacements.has(message.toolCallId)) ||
      replacements.size !== pending.length
    ) {
      throw new Error(
        "Resolved tool results must match every pending tool call"
      );
    }
    this._agent.state.messages = this._agent.state.messages.map((message) =>
      _isDeferredResult(message)
        ? replacements.get(message.toolCallId)!
        : message
    );
    this._deferredCalls.clear();
    await this._persist();
  }

  continue(): Promise<void> {
    return this._agent.continue();
  }

  abort(): void {
    this._agent.abort();
  }

  waitForIdle(): Promise<void> {
    return this._agent.waitForIdle();
  }

  subscribe(
    listener: (event: AgentRuntimeSessionEvent) => Promise<void> | void
  ): () => void {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  private _toolsForMode(mode: RuntimeExecutionMode): AgentTool[] {
    return this._tools.map((tool) => {
      if (mode === "react") return tool;
      if (mode === "autoOnce") {
        return {
          ...tool,
          execute: async (...args: Parameters<AgentTool["execute"]>) => ({
            ...(await tool.execute(...args)),
            terminate: true,
          }),
        } as AgentTool;
      }
      return {
        ...tool,
        execute: (toolCallId: string, input: unknown) => {
          this._deferredCalls.set(toolCallId, {
            id: toolCallId,
            name: tool.name,
            arguments: input,
          });
          return Promise.resolve({
            content: [{ type: "text", text: "" }],
            details: { marker: DEFERRED_MARKER },
            terminate: true,
          });
        },
      } as AgentTool;
    });
  }

  private async _handleAgentEvent(event: AgentEvent): Promise<void> {
    if (event.type === "tool_execution_start") {
      this._toolArguments.set(event.toolCallId, event.args);
    }
    if (this._executionMode === "manual") {
      if (
        event.type === "message_update" &&
        event.assistantMessageEvent.type === "toolcall_end"
      ) {
        return;
      }
      if (
        event.type === "tool_execution_start" ||
        event.type === "tool_execution_update" ||
        event.type === "tool_execution_end"
      ) {
        return;
      }
      if (
        (event.type === "message_start" || event.type === "message_end") &&
        _isDeferredResult(event.message)
      ) {
        return;
      }
    }
    if (
      event.type === "message_update" &&
      event.assistantMessageEvent.type === "toolcall_end" &&
      this._deferredToolNames.has(event.assistantMessageEvent.toolCall.name)
    ) {
      return;
    }
    if (
      (event.type === "tool_execution_start" ||
        event.type === "tool_execution_update") &&
      this._deferredToolNames.has(event.toolName)
    ) {
      return;
    }
    if (
      event.type === "tool_execution_end" &&
      _isDeferredToolResult(event.result)
    ) {
      this._deferredCalls.set(event.toolCallId, {
        id: event.toolCallId,
        name: event.toolName,
        arguments: this._toolArguments.get(event.toolCallId),
      });
      this._toolArguments.delete(event.toolCallId);
      return;
    }
    if (event.type === "tool_execution_end") {
      this._toolArguments.delete(event.toolCallId);
    }
    if (event.type === "turn_end") {
      await this._emit({
        ...event,
        toolResults: event.toolResults.filter(
          (message) => !_isDeferredResult(message)
        ),
      });
      return;
    }
    if (event.type === "agent_end") {
      await this._persist();
      if (this._deferredCalls.size > 0) {
        await this._emit({
          type: "tool_calls_deferred",
          calls: [...this._deferredCalls.values()],
        });
      }
      await this._emit({ ...event, messages: this.messages });
      return;
    }
    await this._emit(event);
  }

  private async _persist(): Promise<void> {
    await this._persistence?.replaceMessages(this.messages);
  }

  private async _emit(event: AgentRuntimeSessionEvent): Promise<void> {
    for (const listener of this._listeners) await listener(event);
  }
}

function _uniqueTools(tools: AgentTool[]): AgentTool[] {
  const names = new Set<string>();
  for (const tool of tools) {
    if (names.has(tool.name)) {
      throw new Error(`Duplicate runtime tool name: ${tool.name}`);
    }
    names.add(tool.name);
  }
  return tools;
}

function _systemPrompt(
  project: AgentProjectSnapshot,
  instructionsPrefix: string
): string {
  return [instructionsPrefix.trim(), project.instructions.trim()]
    .filter(Boolean)
    .join("\n\n");
}

function _isDeferredResult(
  message: AgentMessage
): message is ToolResultMessage<{ marker: string }> {
  return (
    message.role === "toolResult" &&
    (message.details as { marker?: unknown } | undefined)?.marker ===
      DEFERRED_MARKER
  );
}

function _isDeferredToolResult(result: unknown): boolean {
  if (!result || typeof result !== "object" || !("details" in result)) {
    return false;
  }
  return (
    (result as { details?: { marker?: unknown } }).details?.marker ===
    DEFERRED_MARKER
  );
}

function _isRuntimeDeferredTool(
  tool: AgentTool
): tool is RuntimeDeferredAgentTool {
  return RUNTIME_DEFERRED_TOOL in tool;
}

function _publicMessages(messages: AgentMessage[]): AgentMessage[] {
  return messages.filter((message) => !_isDeferredResult(message));
}

function _restoreDeferredPlaceholders(
  messages: AgentMessage[],
  mode: RuntimeExecutionMode
): AgentMessage[] {
  if (mode !== "manual") return messages;
  const last = messages.at(-1);
  if (last?.role !== "assistant") return messages;
  const calls = last.content.filter((content) => content.type === "toolCall");
  if (calls.length === 0) return messages;
  return [
    ...messages,
    ...calls.map((call): ToolResultMessage<{ marker: string }> => ({
      role: "toolResult",
      toolCallId: call.id,
      toolName: call.name,
      content: [{ type: "text", text: "" }],
      details: { marker: DEFERRED_MARKER },
      isError: false,
      timestamp: Date.now(),
    })),
  ];
}
