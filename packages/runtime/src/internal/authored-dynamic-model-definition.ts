import { hasOnlyDynamicTurnStarted } from "./authored-dynamic-turn";

import type {
  DynamicResolveContext,
  DynamicTurnEvent
} from "./authored-dynamic-turn";
import type {
  AgentDynamicModelDefinition,
  AgentDynamicModelSelection,
  AgentModelDefinition
} from "../shared/agent-definition";

const DYNAMIC_MODEL_KIND = "llm-space:dynamic-model" as const;

export interface RuntimeDynamicModelDefinition {
  readonly kind: typeof DYNAMIC_MODEL_KIND;
  readonly fallback: AgentModelDefinition;
  readonly events: {
    readonly "turn.started": (
      event: DynamicTurnEvent,
      context: DynamicResolveContext
    ) => AgentDynamicModelSelection | Promise<AgentDynamicModelSelection | null> | null;
  };
}

export function defineDynamicModelRuntime(
  definition: Omit<RuntimeDynamicModelDefinition, "kind">
): RuntimeDynamicModelDefinition {
  return Object.freeze({ kind: DYNAMIC_MODEL_KIND, ...definition });
}

export function isDynamicModelDefinition(
  value: unknown
): value is AgentDynamicModelDefinition {
  return Boolean(
    value
    && typeof value === "object"
    && (value as { kind?: unknown; }).kind === DYNAMIC_MODEL_KIND
    && typeof (value as { fallback?: unknown; }).fallback === "string"
    && hasOnlyDynamicTurnStarted(
      (value as RuntimeDynamicModelDefinition).events
    )
  );
}

export function createAuthoredAgentVirtualModule(): string {
  return `
    export const defineAgent = definition => definition;
    export const defineDynamic = definition => Object.freeze({
      kind: "${DYNAMIC_MODEL_KIND}",
      ...definition
    });
  `;
}
