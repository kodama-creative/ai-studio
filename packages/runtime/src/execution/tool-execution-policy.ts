import type { AgentMessage, AgentTool } from "@earendil-works/pi-agent-core";
import type { ToolResultMessage } from "@earendil-works/pi-ai";

import type { PreparedAgentTool } from "../runtime/agent/prepared-agent-tool";
import type { RuntimeExecutionMode } from "../shared/runtime-execution-mode";

const DEFERRED_TOOL_RESULT_MARKER = "llm-space-runtime-deferred";

export interface DeferredToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: unknown;
}

export class ToolExecutionPolicy {
  private readonly _tools: PreparedAgentTool[];
  private readonly _toolNames: Set<string>;
  private readonly _staticallyDeferredToolNames: Set<string>;
  private readonly _deferredCalls = new Map<string, DeferredToolCall>();

  constructor({
    tools,
    activeToolNames,
  }: {
    tools: PreparedAgentTool[];
    activeToolNames?: string[];
  }) {
    _assertUniqueToolNames(tools);
    const activeNames = activeToolNames ? new Set(activeToolNames) : null;
    this._tools = activeNames
      ? tools.filter((tool) => activeNames.has(tool.definition.name))
      : tools;
    this._toolNames = new Set(this._tools.map((tool) => tool.definition.name));
    this._staticallyDeferredToolNames = new Set(
      this._tools
        .filter((tool) => tool.kind === "deferred")
        .map((tool) => tool.definition.name)
    );
  }

  get pendingCalls(): DeferredToolCall[] {
    return [...this._deferredCalls.values()];
  }

  hasTool(name: string): boolean {
    return this._toolNames.has(name);
  }

  isStaticallyDeferred(name: string): boolean {
    return this._staticallyDeferredToolNames.has(name);
  }

  toolsForMode(mode: RuntimeExecutionMode): AgentTool[] {
    return this._tools.map((tool) => ({
      ...tool.definition,
      execute: async (
        ...args: Parameters<AgentTool["execute"]>
      ): Promise<Awaited<ReturnType<AgentTool["execute"]>>> => {
        const [toolCallId, input] = args;
        if (mode === "manual" || tool.kind === "deferred") {
          this._defer(toolCallId, tool.definition.name, input);
          return _deferredResult();
        }
        const outcome = await tool.execute(...args);
        if (outcome.type === "deferred") {
          this._defer(toolCallId, tool.definition.name, input);
          return _deferredResult();
        }
        return mode === "autoOnce"
          ? ({ ...outcome.result, terminate: true } as Awaited<
              ReturnType<AgentTool["execute"]>
            >)
          : outcome.result;
      },
    })) as AgentTool[];
  }

  publicMessages(messages: AgentMessage[]): AgentMessage[] {
    return messages.filter((message) => !this.isDeferredResultMessage(message));
  }

  restoreDeferredPlaceholders(
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
        details: { marker: DEFERRED_TOOL_RESULT_MARKER },
        isError: false,
        timestamp: Date.now(),
      })),
    ];
  }

  replaceDeferredResults(
    messages: AgentMessage[],
    results: ToolResultMessage[]
  ): AgentMessage[] {
    const replacements = new Map(
      results.map((result) => [result.toolCallId, result])
    );
    const pending = messages.filter((message) =>
      this.isDeferredResultMessage(message)
    );
    if (
      pending.length === 0 ||
      pending.some((message) => !replacements.has(message.toolCallId)) ||
      replacements.size !== pending.length
    ) {
      throw new Error(
        "Resolved tool results must match every pending tool call"
      );
    }
    const replaced = messages.map((message) =>
      this.isDeferredResultMessage(message)
        ? replacements.get(message.toolCallId)!
        : message
    );
    this._deferredCalls.clear();
    return replaced;
  }

  isDeferredResultMessage(
    message: AgentMessage
  ): message is ToolResultMessage<{ marker: string }> {
    return (
      message.role === "toolResult" &&
      (message.details as { marker?: unknown } | undefined)?.marker ===
        DEFERRED_TOOL_RESULT_MARKER
    );
  }

  isDeferredToolResult(result: unknown): boolean {
    return Boolean(
      result &&
      typeof result === "object" &&
      "details" in result &&
      (result as { details?: { marker?: unknown } }).details?.marker ===
        DEFERRED_TOOL_RESULT_MARKER
    );
  }

  private _defer(id: string, name: string, args: unknown): void {
    this._deferredCalls.set(id, { id, name, arguments: args });
  }
}

function _assertUniqueToolNames(tools: PreparedAgentTool[]): void {
  const names = new Set<string>();
  for (const tool of tools) {
    if (names.has(tool.definition.name)) {
      throw new Error(`Duplicate runtime tool name: ${tool.definition.name}`);
    }
    names.add(tool.definition.name);
  }
}

function _deferredResult(): Awaited<ReturnType<AgentTool["execute"]>> {
  return {
    content: [{ type: "text", text: "" }],
    details: { marker: DEFERRED_TOOL_RESULT_MARKER },
    terminate: true,
  } as Awaited<ReturnType<AgentTool["execute"]>>;
}
