import type { StoredRuntimeSession } from "./session-store";

export interface RuntimeToolApprovalView {
  readonly decidedAt?: number;
  readonly id: string;
  readonly reason?: string;
  readonly requestedAt: number;
  readonly runId: string;
  readonly scope: "call" | "session";
  readonly sourceRequirement: "always" | "deny" | "never" | "once";
  readonly hostRequirement: "always" | "deny" | "never" | "once";
  readonly state: "approved" | "denied" | "pending" | "stale";
  readonly toolCallId: string;
  readonly toolName: string;
}

export function runtimeToolApprovalViews(
  session: StoredRuntimeSession
): readonly RuntimeToolApprovalView[] {
  return (session.snapshot.approvalLedger?.requests ?? []).map(request => ({
    id: request.id,
    runId: request.runId,
    toolCallId: request.toolCallId,
    toolName: request.toolName,
    scope: request.scope,
    sourceRequirement: request.sourceRequirement,
    hostRequirement: request.hostRequirement,
    state: request.state,
    requestedAt: request.requestedAt,
    ...(request.decidedAt === undefined
      ? {}
      : { decidedAt: request.decidedAt }),
    ...(request.reason ? { reason: request.reason } : {})
  }));
}

export function runtimeRunHasParkedToolApprovals(
  session: StoredRuntimeSession,
  runId: string
): boolean {
  const parkedOperationIds = new Set(
    (session.snapshot.operationLedger?.steps ?? []).flatMap(step =>
      step.operations
        .filter(operation => operation.runId === runId
          && operation.state === "parked")
        .map(operation => operation.id))
  );
  return (session.snapshot.approvalLedger?.requests ?? []).some(request =>
    request.runId === runId
    && request.state !== "stale"
    && parkedOperationIds.has(request.operationId));
}
