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
  private _tools: PreparedAgentTool[] = [];
  private _toolNames = new Set<string>();
  private _staticallyDeferredToolNames = new Set<string>();
  private readonly _deferredCalls = new Map<string, DeferredToolCall>();
  private readonly _deniedCalls = new Map<string, string>();
  private readonly _resultErrors = new Set<string>();

  constructor({
    tools,
    activeToolNames
  }: {
    activeToolNames?: string[];
    tools: PreparedAgentTool[];
  }) {
    this.configure({ tools, activeToolNames });
  }

  configure({
    tools,
    activeToolNames
  }: {
    activeToolNames?: readonly string[];
    tools: PreparedAgentTool[];
  }): void {
    _assertUniqueToolNames(tools);
    const activeNames = activeToolNames ? new Set(activeToolNames) : null;
    this._tools = activeNames
      ? tools.filter(tool => activeNames.has(tool.definition.name))
      : tools;
    this._toolNames = new Set(this._tools.map(tool => tool.definition.name));
    this._staticallyDeferredToolNames = new Set(
      this._tools
        .filter(tool => tool.kind === "deferred")
        .map(tool => tool.definition.name)
    );
  }

  get pendingCalls(): DeferredToolCall[] {
    return [...this._deferredCalls.values()];
  }

  hasTool(name: string): boolean {
    return this._toolNames.has(name);
  }

  preparedTool(name: string): PreparedAgentTool | undefined {
    return this._tools.find(tool => tool.definition.name === name);
  }

  isStaticallyDeferred(name: string): boolean {
    return this._staticallyDeferredToolNames.has(name);
  }

  executesAutomatically(name: string, mode: RuntimeExecutionMode): boolean {
    const tool = this._tools.find(item => item.definition.name === name);
    return Boolean(
      tool?.kind === "executable"
      && (mode !== "manual" || tool.manualAutomatic)
    );
  }

  consumeResultError(toolCallId: string): boolean | undefined {
    if (!this._resultErrors.delete(toolCallId)) { return undefined; }
    return true;
  }

  denyCall(toolCallId: string, reason: string): void {
    this._deniedCalls.set(toolCallId, reason);
  }

  toolsForMode(mode: RuntimeExecutionMode): AgentTool[] {
    return this._tools.map(tool => ({
      ...tool.definition,
      execute: async (
        ...args: Parameters<AgentTool["execute"]>
      ): Promise<Awaited<ReturnType<AgentTool["execute"]>>> => {
        const [toolCallId, input] = args;
        const denial = this._deniedCalls.get(toolCallId);
        if (denial !== undefined) {
          this._deniedCalls.delete(toolCallId);
          this._resultErrors.add(toolCallId);
          return {
            content: [{ type: "text", text: denial }],
            details: { approval: "denied", notRun: true },
            ...(mode === "autoOnce" ? { terminate: true } : {})
          } as Awaited<ReturnType<AgentTool["execute"]>>;
        }
        if (
          (mode === "manual" && !(
            tool.kind === "executable" && tool.manualAutomatic
          ))
          || tool.kind === "deferred"
        ) {
          this._defer(toolCallId, tool.definition.name, input);
          return _deferredResult();
        }
        const outcome = await tool.execute(...args);
        if (outcome.type === "deferred") {
          this._defer(toolCallId, tool.definition.name, input);
          return _deferredResult();
        }
        const { isError, ...result } = outcome.result;
        if (isError === true) {
          this._resultErrors.add(toolCallId);
        }
        return mode === "autoOnce"
          ? ({ ...result, terminate: true } as Awaited<
            ReturnType<AgentTool["execute"]>
          >)
          : result as Awaited<ReturnType<AgentTool["execute"]>>;
      }
    })) as AgentTool[];
  }

  publicMessages(messages: AgentMessage[]): AgentMessage[] {
    return messages.filter(message => !this.isDeferredResultMessage(message));
  }

  restoreDeferredPlaceholders(
    messages: AgentMessage[],
    mode: RuntimeExecutionMode,
    force = false
  ): AgentMessage[] {
    if (mode !== "manual" && !force) {
      return messages;
    }
    const last = messages.at(-1);
    if (last?.role !== "assistant") {
      return messages;
    }
    const calls = last.content.filter(content => content.type === "toolCall");
    if (calls.length === 0) {
      return messages;
    }
    return [
      ...messages,
      ...calls.map((call): ToolResultMessage<{ marker: string; }> => ({
        role: "toolResult",
        toolCallId: call.id,
        toolName: call.name,
        content: [{ type: "text", text: "" }],
        details: { marker: DEFERRED_TOOL_RESULT_MARKER },
        isError: false,
        timestamp: Date.now()
      }))
    ];
  }

  replaceDeferredResults(
    messages: AgentMessage[],
    results: ToolResultMessage[]
  ): AgentMessage[] {
    const replacements = new Map(
      results.map(result => [result.toolCallId, result])
    );
    const pending = messages.filter(message =>
      this.isDeferredResultMessage(message));
    if (
      pending.length === 0
      || pending.some(message => !replacements.has(message.toolCallId))
      || replacements.size !== pending.length
    ) {
      throw new Error(
        "Resolved tool results must match every pending tool call"
      );
    }
    const replaced = messages.map(message => {
      if (!this.isDeferredResultMessage(message)) {
        return message;
      }
      const replacement = replacements.get(message.toolCallId);
      if (!replacement) {
        throw new Error(`Missing tool result for ${message.toolCallId}`);
      }
      return replacement;
    });
    this._deferredCalls.clear();
    return replaced;
  }

  isDeferredResultMessage(
    message: AgentMessage
  ): message is ToolResultMessage<{ marker: string; }> {
    return (
      message.role === "toolResult"
      && (message.details as { marker?: unknown; } | undefined)?.marker
      === DEFERRED_TOOL_RESULT_MARKER
    );
  }

  isDeferredToolResult(result: unknown): boolean {
    return Boolean(
      result
      && typeof result === "object"
      && "details" in result
      && (result as { details?: { marker?: unknown; }; }).details?.marker
      === DEFERRED_TOOL_RESULT_MARKER
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
    terminate: true
  } as Awaited<ReturnType<AgentTool["execute"]>>;
}
