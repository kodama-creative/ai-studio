import type { AgentModelDefinition } from "@llm-space/agent";

import type { ModelToolDefinition } from "../execution/model-engine";

export interface AgentSnapshot {
  readonly schemaVersion: 1;
  readonly agentId: string;
  readonly generationId: string;
  readonly model: AgentModelDefinition;
  readonly instructions: readonly string[];
  readonly tools: readonly ModelToolDefinition[];
}
