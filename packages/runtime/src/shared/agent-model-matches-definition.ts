import type {
  AgentModelSelector,
  CompiledAgentDefinition
} from "./agent-definition";

export function agentModelMatchesDefinition({
  model,
  reasoning,
  definition
}: {
  definition: CompiledAgentDefinition | null | undefined;
  model: AgentModelSelector | undefined;
  reasoning: CompiledAgentDefinition["reasoning"];
}): boolean {
  return Boolean(
    definition
    && model?.provider === definition.model.provider
    && model.id === definition.model.id
    && reasoning === definition.reasoning
  );
}
