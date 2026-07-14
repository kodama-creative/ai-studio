import type { ThinkingLevel } from "@earendil-works/pi-agent-core";

export type AgentModelDefinition = `${string}/${string}`;

export type AgentReasoningDefinition =
  "provider-default" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh";

export interface AgentDefinition {
  model: AgentModelDefinition;
  reasoning?: AgentReasoningDefinition;
}

export interface AgentModelSelector {
  provider: string;
  id: string;
}

export interface ResolvedAgentDefinition {
  model: AgentModelSelector;
  reasoning?: ThinkingLevel;
}

type ExactAgentDefinition<T extends AgentDefinition> = T &
  Record<Exclude<keyof T, keyof AgentDefinition>, never>;

export function defineAgent<const T extends AgentDefinition>(
  definition: ExactAgentDefinition<T>
): T {
  return definition;
}
