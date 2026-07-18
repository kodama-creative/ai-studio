import type { ExactDefinition } from "./exact-definition";
import type {
  AgentDefinition,
  AgentDynamicModelDefinition,
  AgentEnvironmentRequirement,
  AgentEnvironmentRequirements,
  AgentModelDefinition,
  AgentModelOptionsDefinition,
  AgentReasoningDefinition
} from "../../shared/agent-definition";

export type {
  AgentDefinition,
  AgentDynamicModelDefinition,
  AgentEnvironmentRequirement,
  AgentEnvironmentRequirements,
  AgentModelDefinition,
  AgentModelOptionsDefinition,
  AgentReasoningDefinition
};

export function defineAgent<TAgent extends AgentDefinition>(
  definition: ExactDefinition<TAgent, AgentDefinition>
): TAgent {
  return definition;
}
