import type { ToolContext } from "@llm-space/agent/tools";
import type { AssistantMessage, Message } from "@llm-space/core";

import type { ExecutableAgent } from "../domain";

export interface RunExecutionInput {
  readonly runId: string;
  readonly threadId: string;
  readonly messages: readonly Message[];
  readonly agent: ExecutableAgent;
  /** Static Studio selection applied without changing the authored Agent snapshot. */
  readonly modelOverride?: string;
  /** One Engine-selected durable step; the executor must not advance beyond it. */
  readonly step:
    | { readonly type: "model" }
    | { readonly type: "tools"; readonly toolCallIds: readonly string[] };
  readonly stepIndex: number;
  readonly maxModelTurns: number;
  readonly createMessageId: () => string;
  readonly createToolContext: (input: {
    readonly execution: ToolContext["execution"];
    readonly signal: AbortSignal;
  }) => ToolContext;
}

export type RunExecutionEvent =
  | {
      readonly type: "assistant.delta";
      readonly message: AssistantMessage;
      readonly textDelta?: string;
      readonly thinkingDelta?: string;
    }
  | {
      readonly type: "assistant.completed";
      readonly message: AssistantMessage;
    }
  | {
      readonly type: "tool.started";
      readonly messageId: string;
      readonly toolCallId: string;
      readonly toolName: string;
    }
  | {
      readonly type: "tool.updated";
      readonly messageId: string;
      readonly toolCallId: string;
      readonly message: AssistantMessage;
    }
  | {
      readonly type: "tool.completed";
      readonly messageId: string;
      readonly toolCallId: string;
      readonly message: AssistantMessage;
    };

/**
 * Awaited durable event sink.
 *
 * Executors emit one `assistant.completed` before events for that message's
 * tools, then emit tool updates/completions against the persisted message.
 * They must not advance past an event until the returned Promise settles.
 */
export interface RunExecutionSink {
  accept(event: RunExecutionEvent): Promise<void>;
}

/**
 * Executes one Engine-selected model or tool step for one durable Run.
 *
 * Engine repeatedly invokes this seam for Continue mode and invokes it once for
 * Step mode. Cancellation and execution failures reject so Engine can converge
 * the durable Run to a safe durable state.
 */
export interface RunExecutor {
  executeStep(
    input: RunExecutionInput,
    sink: RunExecutionSink,
    options: { readonly signal: AbortSignal }
  ): Promise<void>;
}
