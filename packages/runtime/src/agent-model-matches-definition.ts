import type {
  AgentModelSelector,
  ResolvedAgentDefinition,
} from "./agent-definition";

export function agentModelMatchesDefinition({
  model,
  reasoning,
  definition,
}: {
  model: AgentModelSelector | undefined;
  reasoning: ResolvedAgentDefinition["reasoning"];
  definition: ResolvedAgentDefinition | null | undefined;
}): boolean {
  return Boolean(
    definition &&
    model?.provider === definition.model.provider &&
    model.id === definition.model.id &&
    reasoning === definition.reasoning
  );
}
