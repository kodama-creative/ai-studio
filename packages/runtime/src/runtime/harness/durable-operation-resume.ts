import {
  type SessionStore,
  SessionStoreConflictError,
  SessionStoreInvariantError,
  type StoredRuntimeSession
} from "./session-store";

export interface DurableOperationResumeClaim {
  readonly expectedVersion: number;
  readonly operationId: string;
  readonly parkId: string;
  readonly requestFingerprint: string;
  readonly resumeSchemaFingerprint: string;
  readonly runId: string;
  readonly sessionId: string;
}

/**
 * Resume one parked operation after the Host has authenticated and authorized
 * the caller. Runtime carries no bearer token; expected-version CAS admits one
 * claimant and the exact park/schema identity prevents cross-wait reuse.
 */
export async function resumeDurableOperation(
  store: SessionStore,
  claim: DurableOperationResumeClaim
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
  return store.commit({
    sessionId: claim.sessionId,
    expectedVersion: claim.expectedVersion,
    mutations: [{
      type: "resumeOperation",
      runId: claim.runId,
      operationId: claim.operationId,
      parkId: claim.parkId,
      requestFingerprint: claim.requestFingerprint,
      resumeSchemaFingerprint: claim.resumeSchemaFingerprint
    }]
  });
}
