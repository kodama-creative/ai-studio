import { activeRuntimeRun } from "./active-runtime-run";
import {
  type SessionStore,
  SessionStoreConflictError,
  SessionStoreInvariantError,
  type StoredRuntimeSession
} from "./session-store";

export interface RuntimeRunResumeClaim {
  readonly expectedVersion: number;
  readonly runId: string;
  readonly sessionId: string;
}

/**
 * Claim one recovered safe wait. The Host must first persist/validate any
 * required tool results. Expected-version CAS lets only one claimant resume.
 */
export async function claimRuntimeRunResume(
  store: SessionStore,
  claim: RuntimeRunResumeClaim
): Promise<StoredRuntimeSession> {
  const current = await store.load(claim.sessionId);
  if (current?.version !== claim.expectedVersion) {
    throw new SessionStoreConflictError(
      claim.sessionId,
      claim.expectedVersion,
      current?.version ?? null
    );
  }
  if (current.snapshot.activeRunId !== claim.runId) {
    throw new SessionStoreInvariantError(
      `Runtime Run ${claim.runId} is not active in Session ${claim.sessionId}`
    );
  }
  const run = activeRuntimeRun(current);
  const mutations = run.state === "waitingForToolResults"
    ? [
      {
        type: "transitionRun" as const,
        runId: run.id,
        to: "waitingForContinue" as const
      },
      {
        type: "transitionRun" as const,
        runId: run.id,
        to: "runningModel" as const
      }
    ]
    : run.state === "waitingForContinue"
      ? [
        {
          type: "transitionRun" as const,
          runId: run.id,
          to: "runningModel" as const
        }
      ]
      : null;
  if (!mutations) {
    throw new SessionStoreInvariantError(
      `Runtime Run ${run.id} cannot resume from ${run.state}`
    );
  }
  return store.commit({
    sessionId: claim.sessionId,
    expectedVersion: claim.expectedVersion,
    mutations
  });
}
