import type {
  AgentModelSelector,
  CompiledAgentDefinition,
} from "./agent-definition";

export function agentModelMatchesDefinition({
  model,
  reasoning,
  definition,
}: {
  model: AgentModelSelector | undefined;
  reasoning: CompiledAgentDefinition["reasoning"];
  definition: CompiledAgentDefinition | null | undefined;
}): boolean {
  return Boolean(
    definition &&
    model?.provider === definition.model.provider &&
    model.id === definition.model.id &&
    reasoning === definition.reasoning
  );
}
