import type { ThinkingLevel } from "@earendil-works/pi-agent-core";

export type AgentModelDefinition = `${string}/${string}`;

export type AgentReasoningDefinition =
  "provider-default" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh";

export interface AgentDefinition {
  readonly model: AgentModelDefinition;
  readonly reasoning?: AgentReasoningDefinition;
}

export interface AgentModelSelector {
  readonly provider: string;
  readonly id: string;
}

export interface CompiledAgentDefinition {
  readonly model: AgentModelSelector;
  readonly reasoning?: ThinkingLevel;
}
