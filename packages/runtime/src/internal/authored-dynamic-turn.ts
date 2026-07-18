import type { AgentSessionContext } from "../shared/agent-session-context";

export interface DynamicTurnEvent { readonly type: "turn.started"; }

export interface DynamicResolveContext {
  readonly session: AgentSessionContext;
}

export function hasOnlyDynamicTurnStarted(value: unknown): boolean {
  return Boolean(
    value
    && typeof value === "object"
    && Object.keys(value).length === 1
    && typeof (value as Record<string, unknown>)["turn.started"] === "function"
  );
}
