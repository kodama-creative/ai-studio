import { defineDynamicModelRuntime } from "../../internal/authored-dynamic-model-definition";

import type { AgentDynamicModelDefinition } from "../../shared/agent-definition";

export function defineDynamic(
  definition: Omit<AgentDynamicModelDefinition, "kind">
): AgentDynamicModelDefinition {
  return defineDynamicModelRuntime(definition);
}
