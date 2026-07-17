import type { ThinkingLevel } from "@earendil-works/pi-agent-core";

export type AgentModelDefinition = `${string}/${string}`;

export type AgentReasoningDefinition =
  "high" | "low" | "medium" | "minimal" | "none" | "provider-default" | "xhigh";

export interface AgentEnvironmentRequirement {
  readonly default?: never;
  readonly description?: string;
  readonly kind: "config" | "secret";
  readonly required: boolean;
}

export type AgentEnvironmentRequirements = Readonly<
  Record<string, AgentEnvironmentRequirement>
>;

export interface AgentDefinition {
  readonly environment?: AgentEnvironmentRequirements;
  readonly model: AgentModelDefinition;
  readonly reasoning?: AgentReasoningDefinition;
}

export interface AgentModelSelector {
  readonly provider: string;
  readonly id: string;
}

export interface CompiledAgentDefinition {
  readonly environment?: AgentEnvironmentRequirements;
  readonly model: AgentModelSelector;
  readonly reasoning?: ThinkingLevel;
}
