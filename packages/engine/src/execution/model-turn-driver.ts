import type { Message, ModelUsage, ResponseOutputItem } from "@llm-space/core";

import type { AgentSnapshot, ModelToolDefinition } from "../domain";

export interface ModelTurnInput {
  readonly agentId: string;
  readonly instructions: readonly string[];
  readonly messages: readonly Message[];
  readonly model: AgentSnapshot["model"];
  readonly tools: readonly ModelToolDefinition[];
}

export interface ModelToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: Readonly<Record<string, unknown>>;
}

export type ModelTurnEvent =
  | { readonly type: "text.delta"; readonly delta: string }
  | { readonly type: "thinking.delta"; readonly delta: string }
  | { readonly type: "tool.call"; readonly call: ModelToolCall }
  | {
      readonly type: "finish";
      readonly reason: "stop" | "tool-calls" | "length" | "other";
      readonly usage?: ModelUsage;
      readonly responseOutputItems?: readonly ResponseOutputItem[];
    };

/** Provider-neutral seam for exactly one model step. Engine owns the tool loop. */
export interface ModelTurnDriver {
  run(
    input: ModelTurnInput,
    options: { readonly signal: AbortSignal }
  ): AsyncIterable<ModelTurnEvent>;
}
