import { RuntimeApprovalAuthorizationError } from "./runtime-approval-authorization-error";
import { fingerprintRuntimeApprovalPrincipal } from "./runtime-approval-principal";
import {
  type SessionStore,
  SessionStoreConflictError,
  SessionStoreInvariantError,
  type StoredRuntimeSession
} from "./session-store";

import type { AgentPrincipal } from "../../shared/agent-session-context";

export async function claimRuntimeToolApproval(
  store: SessionStore,
  input: {
    readonly actor: {
      readonly current: AgentPrincipal;
      readonly initiator: AgentPrincipal;
    };
    readonly expectedVersion: number;
    readonly requestId: string;
    readonly runId: string;
    readonly sessionId: string;
  }
): Promise<StoredRuntimeSession> {
  const current = await store.load(input.sessionId);
  if (current?.version !== input.expectedVersion) {
    throw new SessionStoreConflictError(
      input.sessionId,
      input.expectedVersion,
      current?.version ?? null
    );
  }
  const request = current.snapshot.approvalLedger?.requests.find(
    item => item.id === input.requestId
  );
  if (
    current.snapshot.activeRunId !== input.runId
    || request?.runId !== input.runId
    || request.state !== "approved"
  ) {
    throw new SessionStoreInvariantError(
      `Tool approval ${input.requestId} is not approved in Runtime Run ${input.runId}`
    );
  }
  const [currentPrincipalFingerprint, initiatorPrincipalFingerprint] =
    await Promise.all([
      fingerprintRuntimeApprovalPrincipal(input.actor.current),
      fingerprintRuntimeApprovalPrincipal(input.actor.initiator)
    ]);
  if (
    request.currentPrincipalFingerprint !== currentPrincipalFingerprint
    || request.initiatorPrincipalFingerprint
    !== initiatorPrincipalFingerprint
  ) {
    throw new RuntimeApprovalAuthorizationError();
  }
  const operation = current.snapshot.operationLedger?.steps
    .flatMap(step => step.operations)
    .find(item => item.id === request.operationId);
  if (
    operation?.state !== "parked"
    || operation.park?.parkId !== request.id
  ) {
    throw new SessionStoreInvariantError(
      `Tool approval ${input.requestId} has no matching parked operation`
    );
  }
  return store.commit({
    sessionId: input.sessionId,
    expectedVersion: input.expectedVersion,
    mutations: [{
      type: "resumeOperation",
      runId: input.runId,
      operationId: operation.id,
      parkId: operation.park.parkId,
      requestFingerprint: operation.requestFingerprint,
      resumeSchemaFingerprint: operation.park.resumeSchemaFingerprint
    }]
  });
}
