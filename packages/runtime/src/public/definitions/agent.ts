import type { ExactDefinition } from "./exact-definition";
import type {
  AgentDefinition,
  AgentDynamicModelDefinition,
  AgentEnvironmentRequirement,
  AgentEnvironmentRequirements,
  AgentModelDefinition,
  AgentModelOptionsDefinition,
  AgentReasoningDefinition,
  AgentSessionLimitsDefinition
} from "../../shared/agent-definition";
export { DEFAULT_MAX_MODEL_CALLS_PER_RUN } from "../../shared/agent-definition";

export type {
  AgentDefinition,
  AgentDynamicModelDefinition,
  AgentEnvironmentRequirement,
  AgentEnvironmentRequirements,
  AgentModelDefinition,
  AgentModelOptionsDefinition,
  AgentReasoningDefinition,
  AgentSessionLimitsDefinition
};

export function defineAgent<TAgent extends AgentDefinition>(
  definition: ExactDefinition<TAgent, AgentDefinition>
): TAgent {
  return definition;
}
