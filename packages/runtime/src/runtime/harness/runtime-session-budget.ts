import type {
  RuntimeSessionBudgetSnapshot,
  RuntimeSessionBudgetWaitSnapshot,
  SessionStore,
  StoredRuntimeSession
} from "./session-store";

export interface RuntimeSessionBudgetView {
  readonly inputBaseline: number;
  readonly inputTokens: number;
  readonly outputBaseline: number;
  readonly outputTokens: number;
  readonly unmeteredProviderCalls: number;
  readonly wait: RuntimeSessionBudgetWaitSnapshot | null;
}

export function runtimeSessionBudgetView(
  session: StoredRuntimeSession
): RuntimeSessionBudgetView {
  const budget = session.snapshot.budget ?? _emptyBudget();
  return {
    inputBaseline: budget.inputBaseline,
    inputTokens: budget.inputTokens,
    outputBaseline: budget.outputBaseline,
    outputTokens: budget.outputTokens,
    unmeteredProviderCalls: budget.unmeteredProviderCalls,
    wait: budget.waits.at(-1) ?? null
  };
}

export async function parkRuntimeRunForBudget(
  store: SessionStore,
  input: {
    readonly expectedVersion: number;
    readonly runId: string;
    readonly sessionId: string;
  }
): Promise<StoredRuntimeSession> {
  return store.commit({
    sessionId: input.sessionId,
    expectedVersion: input.expectedVersion,
    mutations: [{ type: "parkSessionBudget", runId: input.runId }]
  });
}

export async function decideRuntimeSessionBudget(
  store: SessionStore,
  input: {
    readonly decision: "freshWindow" | "stop";
    readonly expectedVersion: number;
    readonly runId: string;
    readonly sessionId: string;
  }
): Promise<StoredRuntimeSession> {
  return store.commit({
    sessionId: input.sessionId,
    expectedVersion: input.expectedVersion,
    mutations: [{
      type: "decideSessionBudget",
      runId: input.runId,
      decision: input.decision
    }]
  });
}

function _emptyBudget(): RuntimeSessionBudgetSnapshot {
  return {
    schemaVersion: 1,
    inputBaseline: 0,
    inputTokens: 0,
    outputBaseline: 0,
    outputTokens: 0,
    unmeteredProviderCalls: 0,
    waits: []
  };
}
