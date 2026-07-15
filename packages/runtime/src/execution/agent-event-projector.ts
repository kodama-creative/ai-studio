import type { AgentEvent, AgentMessage } from "@earendil-works/pi-agent-core";

import type {
  DeferredToolCall,
  ToolExecutionPolicy
} from "./tool-execution-policy";
import type { RuntimeExecutionMode } from "../shared/runtime-execution-mode";

export type AgentSessionEvent =
  { calls: DeferredToolCall[]; type: "tool_calls_deferred"; } | AgentEvent;

export interface AgentSessionPersistence {
  replaceMessages(messages: AgentMessage[]): Promise<void> | void;
}

export class AgentEventProjector {
  private readonly _listeners = new Set<
    (event: AgentSessionEvent) => Promise<void> | void
  >();

  constructor(
    private readonly _executionMode: () => RuntimeExecutionMode,
    private readonly _toolPolicy: ToolExecutionPolicy,
    private readonly _messages: () => AgentMessage[],
    private readonly _persistence?: AgentSessionPersistence
  ) {}

  subscribe(
    listener: (event: AgentSessionEvent) => Promise<void> | void
  ): () => void {
    this._listeners.add(listener);
    return () => { this._listeners.delete(listener); };
  }

  async handleToolResultsResolved(): Promise<void> {
    await this._persist();
  }

  async handle(event: AgentEvent): Promise<void> {
    if (this._executionMode() === "manual") {
      if (
        event.type === "message_update"
        && event.assistantMessageEvent.type === "toolcall_end"
      ) {
        return;
      }
      if (
        event.type === "tool_execution_start"
        || event.type === "tool_execution_update"
        || event.type === "tool_execution_end"
      ) {
        return;
      }
      if (
        (event.type === "message_start" || event.type === "message_end")
        && this._toolPolicy.isDeferredResultMessage(event.message)
      ) {
        return;
      }
    }
    if (
      event.type === "message_update"
      && event.assistantMessageEvent.type === "toolcall_end"
      && this._toolPolicy.hasTool(event.assistantMessageEvent.toolCall.name)
    ) {
      return;
    }
    if (
      (event.type === "tool_execution_start"
        || event.type === "tool_execution_update")
      && this._toolPolicy.isStaticallyDeferred(event.toolName)
    ) {
      return;
    }
    if (
      event.type === "tool_execution_end"
      && this._toolPolicy.isDeferredToolResult(event.result)
    ) {
      return;
    }
    if (event.type === "turn_end") {
      await this._emit({
        ...event,
        toolResults: event.toolResults.filter(
          message => !this._toolPolicy.isDeferredResultMessage(message)
        )
      });
      return;
    }
    if (event.type === "agent_end") {
      const messages = this._messages();
      await this._persist();
      if (this._toolPolicy.pendingCalls.length > 0) {
        await this._emit({
          type: "tool_calls_deferred",
          calls: this._toolPolicy.pendingCalls
        });
      }
      await this._emit({ ...event, messages });
      return;
    }
    await this._emit(event);
  }

  private async _emit(event: AgentSessionEvent): Promise<void> {
    for (const listener of this._listeners) { await listener(event); }
  }

  private async _persist(): Promise<void> {
    await this._persistence?.replaceMessages(this._messages());
  }
}
