export const RUNTIME_TOOL_APPROVAL_LEDGER_SCHEMA_VERSION = 1 as const;

export const RUNTIME_TOOL_APPROVAL_REQUEST_STATES = [
  "pending",
  "approved",
  "denied",
  "stale"
] as const;

export type RuntimeToolApprovalRequestState =
  typeof RUNTIME_TOOL_APPROVAL_REQUEST_STATES[number];

export interface RuntimeToolApprovalRequestSnapshot {
  readonly agentSnapshotFingerprint: string;
  readonly contributionId: string;
  readonly currentPrincipalFingerprint: string;
  readonly decidedAt?: number;
  readonly hostPolicyFingerprint: string;
  readonly id: string;
  readonly initiatorPrincipalFingerprint: string;
  readonly operationId: string;
  readonly reason?: string;
  readonly requestFingerprint: string;
  readonly requestedAt: number;
  readonly runId: string;
  readonly scope: "call" | "session";
  readonly sourcePolicyFingerprint: string;
  readonly sourceRequirement: "always" | "deny" | "never" | "once";
  readonly hostRequirement: "always" | "deny" | "never" | "once";
  readonly state: RuntimeToolApprovalRequestState;
  readonly stepId: string;
  readonly toolCallId: string;
  readonly toolName: string;
}

export interface RuntimeToolApprovalGrantSnapshot {
  readonly agentSnapshotFingerprint: string;
  readonly contributionId: string;
  readonly currentPrincipalFingerprint: string;
  readonly grantedAt: number;
  readonly hostPolicyFingerprint: string;
  readonly id: string;
  readonly initiatorPrincipalFingerprint: string;
  readonly requestId: string;
  readonly sourcePolicyFingerprint: string;
  readonly toolName: string;
}

export interface RuntimeToolApprovalLedgerSnapshot {
  readonly grants: readonly RuntimeToolApprovalGrantSnapshot[];
  readonly requests: readonly RuntimeToolApprovalRequestSnapshot[];
  readonly schemaVersion: typeof RUNTIME_TOOL_APPROVAL_LEDGER_SCHEMA_VERSION;
}
