import type { ExactDefinition } from "./exact-definition";
import type {
  AgentDefinition,
  AgentEnvironmentRequirement,
  AgentEnvironmentRequirements,
  AgentModelDefinition,
  AgentReasoningDefinition
} from "../../shared/agent-definition";

export type {
  AgentDefinition,
  AgentEnvironmentRequirement,
  AgentEnvironmentRequirements,
  AgentModelDefinition,
  AgentReasoningDefinition
};

export function defineAgent<TAgent extends AgentDefinition>(
  definition: ExactDefinition<TAgent, AgentDefinition>
): TAgent {
  return definition;
}
