import type { CallSettings, LanguageModel } from "ai";

import type { RemoteAgentDefinition } from "./remote-agent";
import {
  defineDynamic as _defineDynamic,
  type AgentBuildDefinition,
  type DynamicEvents,
  type DynamicSentinel,
  type ExactDefinition,
  type JsonObject,
  type SchemaSource,
} from "./shared/types";

declare const DEFINED_AGENT: unique symbol;

export interface AgentModelOptionsDefinition {
  readonly providerOptions?: Record<string, JsonObject>;
}

export type AgentReasoningDefinition = NonNullable<CallSettings["reasoning"]>;
export type AgentStaticModelDefinition =
  string | Exclude<LanguageModel, string>;
export type AgentModelResolveContext =
  import("./shared/types").DynamicResolveContext;

export interface AgentModelSelectionDefinition {
  readonly model: AgentStaticModelDefinition;
  readonly modelContextWindowTokens?: number;
  readonly modelOptions?: AgentModelOptionsDefinition;
}

export type AgentDynamicModelResult =
  AgentStaticModelDefinition | AgentModelSelectionDefinition | null;
export type AgentModelResolver = (
  event: unknown,
  ctx: AgentModelResolveContext
) => AgentDynamicModelResult | Promise<AgentDynamicModelResult>;
export type AgentDynamicModelDefinition = DynamicSentinel<
  AgentDynamicModelResult,
  AgentStaticModelDefinition
>;
export type AgentModelDefinition =
  AgentStaticModelDefinition | AgentDynamicModelDefinition;

export interface AgentCompactionDefinition {
  readonly modelContextWindowTokens?: number;
  readonly model?: AgentStaticModelDefinition;
  readonly thresholdPercent?: number;
}

export interface AgentLimitsDefinition {
  readonly sessionTimeoutMs?: number | false;
  readonly maxInputTokensPerSession?: number | false;
  readonly maxOutputTokensPerSession?: number | false;
}

export type AgentWorkflowWorldDefinition = string;

export interface AgentWorkflowDefinition {
  readonly world?: AgentWorkflowWorldDefinition;
}

export interface AgentExperimentalDefinition {
  readonly subagentPersistentSessions?: boolean;
  readonly workflow?: AgentWorkflowDefinition;
}

export interface AgentDefinition {
  readonly description?: string;
  readonly build?: AgentBuildDefinition;
  readonly compaction?: AgentCompactionDefinition;
  readonly experimental?: AgentExperimentalDefinition;
  readonly model: AgentModelDefinition;
  readonly modelContextWindowTokens?: number;
  readonly modelOptions?: AgentModelOptionsDefinition;
  readonly reasoning?: AgentReasoningDefinition;
  readonly limits?: AgentLimitsDefinition;
  readonly outputSchema?: SchemaSource;
}

export type DefinedAgent<TAgent extends AgentDefinition = AgentDefinition> =
  TAgent & { readonly [DEFINED_AGENT]: true };

export type DynamicLocalSubagentDefinition = AgentDefinition & {
  readonly description: string;
};
export type DynamicSubagentDefinition =
  DynamicLocalSubagentDefinition | RemoteAgentDefinition;

type DynamicEventHandler<TEvents extends DynamicEvents> = Extract<
  NonNullable<TEvents[keyof TEvents]>,
  (...args: never[]) => unknown
>;
type DynamicEventResult<TEvents extends DynamicEvents> = Awaited<
  ReturnType<DynamicEventHandler<TEvents>>
>;
type DynamicSubagentDescriptionConstraint<TEvents extends DynamicEvents> =
  Exclude<
    Extract<DynamicEventResult<TEvents>, DefinedAgent>,
    DynamicLocalSubagentDefinition
  > extends never
    ? unknown
    : { readonly "Dynamic subagent definitions require a description": never };

interface DefineDynamicAgent {
  <const TEvents extends DynamicEvents, TFallback>(
    definition: {
      readonly fallback: TFallback;
      readonly events: TEvents;
    } & DynamicSubagentDescriptionConstraint<TEvents>
  ): DynamicSentinel<
    Exclude<DynamicEventResult<TEvents>, undefined>,
    TFallback
  >;
  <const TEvents extends DynamicEvents>(
    definition: {
      readonly build?: AgentBuildDefinition;
      readonly events: TEvents;
    } & DynamicSubagentDescriptionConstraint<TEvents>
  ): DynamicSentinel<DynamicEventResult<TEvents>>;
}

export const defineDynamic: DefineDynamicAgent = ((definition: {
  readonly build?: AgentBuildDefinition;
  readonly events: DynamicEvents;
  readonly fallback?: unknown;
}) => _defineDynamic(definition)) as DefineDynamicAgent;

export function defineAgent<TAgent extends AgentDefinition>(
  definition: ExactDefinition<TAgent, AgentDefinition>
): DefinedAgent<TAgent>;
export function defineAgent(definition: AgentDefinition): AgentDefinition {
  return definition;
}
