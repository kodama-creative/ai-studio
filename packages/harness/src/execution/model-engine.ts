import type { AgentModelDefinition } from "@llm-space/agent";

import type { HarnessMessage, HarnessToolCall } from "../session/protocol";

export interface ModelToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly outputSchema?: Readonly<Record<string, unknown>>;
}

export interface ModelTurnInput {
  readonly agentId: string;
  readonly instructions: readonly string[];
  readonly messages: readonly HarnessMessage[];
  readonly model: AgentModelDefinition;
  readonly tools: readonly ModelToolDefinition[];
}

export type ModelTurnEvent =
  | { readonly type: "text.delta"; readonly delta: string }
  | { readonly type: "tool.call"; readonly call: HarnessToolCall }
  | {
      readonly type: "finish";
      readonly reason: "stop" | "tool-calls" | "length" | "other";
    };

/** Host port for one model step. Harness owns the outer tool loop. */
export interface ModelTurnEngine {
  run(
    input: ModelTurnInput,
    options: { readonly signal: AbortSignal }
  ): AsyncIterable<ModelTurnEvent>;
}
