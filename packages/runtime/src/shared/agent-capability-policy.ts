import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { CacheRetention, Transport } from "@earendil-works/pi-ai";

import type { AgentModelSelector } from "./agent-definition";

export interface AgentCapabilityNumberRange {
  readonly max: number;
  readonly min: number;
}

export interface AgentCapabilityPolicy {
  readonly connectionContributions: readonly string[];
  readonly modelOptions: {
    readonly cacheRetention?: readonly CacheRetention[];
    readonly maxRetries?: AgentCapabilityNumberRange;
    readonly maxRetryDelayMs?: AgentCapabilityNumberRange;
    readonly maxTokens?: AgentCapabilityNumberRange;
    readonly temperature?: AgentCapabilityNumberRange;
    readonly thinkingBudgets?: AgentCapabilityNumberRange;
    readonly timeoutMs?: AgentCapabilityNumberRange;
    readonly transport?: readonly Transport[];
    readonly websocketConnectTimeoutMs?: AgentCapabilityNumberRange;
  };
  readonly models: readonly AgentModelSelector[];
  readonly reasoning: readonly ThinkingLevel[];
  readonly toolContributions: readonly string[];
}
