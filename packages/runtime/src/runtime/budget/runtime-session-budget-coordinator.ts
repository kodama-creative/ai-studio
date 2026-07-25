import {
  parkRuntimeRunForBudget,
  type SessionStore,
  SessionStoreConflictError,
  type StoredRuntimeSession
} from "../harness";

export class RuntimeSessionBudgetCoordinator {
  private readonly _onCommitted?: (
    session: StoredRuntimeSession
  ) => Promise<void> | void;

  private readonly _runId: string;
  private readonly _sessionId: string;
  private readonly _store?: SessionStore;

  constructor(input: {
    readonly onCommitted?: (
      session: StoredRuntimeSession
    ) => Promise<void> | void;
    readonly runId: string;
    readonly sessionId: string;
    readonly store?: SessionStore;
  }) {
    this._onCommitted = input.onCommitted;
    this._runId = input.runId;
    this._sessionId = input.sessionId;
    this._store = input.store;
  }

  async isWaiting(): Promise<boolean> {
    const current = await this._store?.load(this._sessionId);
    return current?.snapshot.runs.find(run => run.id === this._runId)?.state
      === "waitingForBudget";
  }

  async parkIfReached(): Promise<boolean> {
    const store = this._store;
    if (!store) { return false; }
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const current = await store.load(this._sessionId);
      const run = current?.snapshot.runs.find(item => item.id === this._runId);
      if (current?.snapshot.activeRunId !== this._runId || !run) {
        return false;
      }
      if (run.state === "waitingForBudget") { return true; }
      if (run.state !== "runningModel" && run.state !== "runningTools") {
        return false;
      }
      const configuration = current.configurations.find(
        item => item.id === run.configurationId
      );
      const budget = current.snapshot.budget;
      const limits = configuration?.limits;
      if (!limits || !budget) { return false; }
      const input = budget.inputTokens - budget.inputBaseline;
      const output = budget.outputTokens - budget.outputBaseline;
      const reached = (
        typeof limits.maxInputTokensPerSession === "number"
        && input >= limits.maxInputTokensPerSession
      ) || (
        typeof limits.maxOutputTokensPerSession === "number"
        && output >= limits.maxOutputTokensPerSession
      );
      if (!reached) { return false; }
      try {
        const parked = await parkRuntimeRunForBudget(store, {
          sessionId: this._sessionId,
          runId: this._runId,
          expectedVersion: current.version
        });
        await this._onCommitted?.(parked);
        return true;
      } catch (error) {
        if (!(error instanceof SessionStoreConflictError) || attempt > 0) {
          throw error;
        }
      }
    }
    return false;
  }
}
