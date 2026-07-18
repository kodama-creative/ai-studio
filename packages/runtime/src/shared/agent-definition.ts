import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type {
  CacheRetention,
  ThinkingBudgets,
  Transport
} from "@earendil-works/pi-ai";

import type {
  DynamicResolveContext,
  DynamicTurnEvent
} from "../internal/authored-dynamic-turn";

export type AgentModelDefinition = `${string}/${string}`;

export type AgentReasoningDefinition =
  "high" | "low" | "medium" | "minimal" | "none" | "provider-default" | "xhigh";

export interface AgentModelOptionsDefinition {
  readonly cacheRetention?: CacheRetention;
  readonly maxRetryDelayMs?: number;
  readonly maxRetries?: number;
  readonly maxTokens?: number;
  readonly reasoning?: AgentReasoningDefinition;
  readonly temperature?: number;
  readonly thinkingBudgets?: ThinkingBudgets;
  readonly timeoutMs?: number;
  readonly transport?: Transport;
  readonly websocketConnectTimeoutMs?: number;
}

export type AgentDynamicModelSelection =
  | {
    readonly model: AgentModelDefinition;
    readonly modelOptions?: AgentModelOptionsDefinition;
  }
  | AgentModelDefinition;

export interface AgentDynamicModelDefinition {
  readonly kind: "llm-space:dynamic-model";
  readonly fallback: AgentModelDefinition;
  readonly events: {
    readonly "turn.started": (
      event: DynamicTurnEvent,
      context: DynamicResolveContext
    ) => AgentDynamicModelSelection | Promise<AgentDynamicModelSelection | null> | null;
  };
}

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
  readonly model: AgentDynamicModelDefinition | AgentModelDefinition;
  readonly modelOptions?: AgentModelOptionsDefinition;
  readonly reasoning?: AgentReasoningDefinition;
}

export interface AgentModelSelector {
  readonly provider: string;
  readonly id: string;
}

export interface CompiledAgentDefinition {
  readonly dynamicModel?: AgentDynamicModelDefinition;
  readonly environment?: AgentEnvironmentRequirements;
  readonly model: AgentModelSelector;
  readonly modelOptions?: AgentModelOptionsDefinition;
  readonly reasoning?: ThinkingLevel;
}
