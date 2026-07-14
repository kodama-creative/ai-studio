import type {
  AgentDefinition,
  AgentModelDefinition,
  AgentReasoningDefinition,
} from "../../shared/agent-definition";

import type { ExactDefinition } from "./exact";

export type { AgentDefinition, AgentModelDefinition, AgentReasoningDefinition };

export function defineAgent<TAgent extends AgentDefinition>(
  definition: ExactDefinition<TAgent, AgentDefinition>
): TAgent {
  return definition;
}
