import { RuntimeApprovalAuthorizationError } from "./runtime-approval-authorization-error";
import { fingerprintRuntimeApprovalPrincipal } from "./runtime-approval-principal";
import {
  SessionStoreConflictError,
  SessionStoreInvariantError
} from "./session-store";

import type {
  SessionStore,
  StoredRuntimeSession
} from "./session-store";
import type { AgentPrincipal } from "../../shared/agent-session-context";

export async function decideRuntimeToolApproval(
  store: SessionStore,
  input: {
    readonly actor: {
      readonly current: AgentPrincipal;
      readonly initiator: AgentPrincipal;
    };
    readonly decision: "approved" | "denied";
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
  if (current.snapshot.activeRunId !== input.runId) {
    throw new SessionStoreInvariantError(
      `Runtime Run ${input.runId} is not active in Session ${input.sessionId}`
    );
  }
  const request = current.snapshot.approvalLedger?.requests.find(
    item => item.id === input.requestId
  );
  if (request?.runId !== input.runId || request.state !== "pending") {
    throw new SessionStoreInvariantError(
      `Tool approval ${input.requestId} is not pending in Runtime Run ${input.runId}`
    );
  }
  const [currentPrincipalFingerprint, initiatorPrincipalFingerprint] =
    await Promise.all([
      fingerprintRuntimeApprovalPrincipal(input.actor.current),
      fingerprintRuntimeApprovalPrincipal(input.actor.initiator)
    ]);
  if (
    request.currentPrincipalFingerprint !== currentPrincipalFingerprint
    || request.initiatorPrincipalFingerprint !== initiatorPrincipalFingerprint
  ) {
    throw new RuntimeApprovalAuthorizationError();
  }
  return store.commit({
    sessionId: input.sessionId,
    expectedVersion: input.expectedVersion,
    mutations: [{
      type: "decideToolApproval",
      decision: input.decision,
      requestId: input.requestId,
      runId: input.runId,
      currentPrincipalFingerprint,
      initiatorPrincipalFingerprint
    }]
  });
}
