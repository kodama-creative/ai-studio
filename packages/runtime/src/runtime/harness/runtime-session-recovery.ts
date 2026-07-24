import { activeRuntimeRun } from "./active-runtime-run";
import {
  type SessionStore,
  SessionStoreInvariantError,
  type StoredRuntimeSession
} from "./session-store";

import type { RuntimeRunSnapshot } from "./runtime-run";

export type RuntimeSessionRecoveryResult =
  | {
    readonly run: RuntimeRunSnapshot;
    readonly session: StoredRuntimeSession;
    readonly status: "cancelled";
  }
  | {
    readonly run: RuntimeRunSnapshot;
    readonly session: StoredRuntimeSession;
    readonly status: "operationReplay";
  }
  | {
    readonly run: RuntimeRunSnapshot;
    readonly session: StoredRuntimeSession;
    readonly status: "outcomeUnknown";
  }
  | {
    readonly run: RuntimeRunSnapshot;
    readonly session: StoredRuntimeSession;
    readonly status: "parked";
  }
  | {
    readonly run: RuntimeRunSnapshot;
    readonly session: StoredRuntimeSession;
    readonly status: "resumable";
  }
  | {
    readonly session: StoredRuntimeSession;
    readonly status: "idle";
  }
  | { readonly status: "missing"; };

/**
 * Reconstruct one Session after process loss without replaying external work.
 * Safe waits remain resumable. Durable operation completions may be replayed;
 * a pre-call without a terminal is atomically elevated to outcome unknown.
 */
export async function recoverRuntimeSession(
  store: SessionStore,
  sessionId: string
): Promise<RuntimeSessionRecoveryResult> {
  const current = await store.load(sessionId);
  if (!current) {
    return { status: "missing" };
  }
  if (current.snapshot.activeRunId === null) {
    return { status: "idle", session: current };
  }
  const run = activeRuntimeRun(current);
  if (
    run.state === "waitingForApproval"
  ) {
    return { status: "parked", run, session: current };
  }
  if (
    run.state === "waitingForToolResults"
    || run.state === "waitingForContinue"
  ) {
    return { status: "resumable", run, session: current };
  }
  if (run.state !== "runningModel" && run.state !== "runningTools") {
    throw new SessionStoreInvariantError(
      `Runtime Run ${run.id} cannot be recovered from ${run.state}`
    );
  }
  const activeStep = current.snapshot.operationLedger?.steps.find(
    step => step.runId === run.id && step.state === "active"
  );
  const operations = activeStep?.operations ?? [];
  if (operations.some(operation => operation.state === "parked")) {
    return { status: "parked", run, session: current };
  }
  if (
    operations.length > 0
    && operations.every(operation => operation.state === "cancelled")
  ) {
    const cancelled = await store.commit({
      sessionId,
      expectedVersion: current.version,
      mutations: [{ type: "transitionRun", runId: run.id, to: "cancelled" }]
    });
    const cancelledRun = cancelled.snapshot.runs.find(item => item.id === run.id);
    if (!cancelledRun) {
      throw new SessionStoreInvariantError(
        `Recovered Session ${sessionId} lost Runtime Run ${run.id}`
      );
    }
    return { status: "cancelled", run: cancelledRun, session: cancelled };
  }
  const ambiguous = operations.filter(operation =>
    operation.state === "preCall" || operation.state === "outcomeUnknown");
  if (ambiguous.length === 0) {
    return { status: "operationReplay", run, session: current };
  }
  const recovered = await store.commit({
    sessionId,
    expectedVersion: current.version,
    mutations: [
      ...ambiguous
        .filter(operation => operation.state === "preCall")
        .map(operation => ({
          type: "settleOperation" as const,
          runId: run.id,
          operationId: operation.id,
          requestFingerprint: operation.requestFingerprint,
          state: "outcomeUnknown" as const
        })),
      { type: "transitionRun", runId: run.id, to: "outcomeUnknown" }
    ]
  });
  const unknownRun = recovered.snapshot.runs.find(item => item.id === run.id);
  if (!unknownRun) {
    throw new SessionStoreInvariantError(
      `Recovered Session ${sessionId} lost Runtime Run ${run.id}`
    );
  }
  return {
    status: "outcomeUnknown",
    run: unknownRun,
    session: recovered
  };
}
