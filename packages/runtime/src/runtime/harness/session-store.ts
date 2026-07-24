import type { ThinkingLevel } from "@earendil-works/pi-agent-core";

import type {
  RuntimeDurableOperationLedgerSnapshot,
  RuntimeDurableOperationPark,
  RuntimeDurableOperationReplayEnvelope
} from "./durable-operation";
import type {
  RuntimeToolApprovalLedgerSnapshot
} from "./durable-tool-approval";
import type {
  RuntimeRunSnapshot,
  RuntimeRunState,
  RuntimeStructuredOutputResult
} from "./runtime-run";
import type { ApprovalRequirement } from "../../public/definitions/approval";
import type { ExecutionEnvToolKind } from "../../public/definitions/execution-env-tool";
import type {
  AgentModelOptionsDefinition,
  AgentModelSelector
} from "../../shared/agent-definition";
import type { RuntimeExecutionMode } from "../../shared/runtime-execution-mode";

export const RUNTIME_SESSION_SCHEMA_VERSION = 3 as const;
export const RUNTIME_SESSION_STATE_SCHEMA_VERSION = 1 as const;
export const MAX_SESSION_STATE_SLOTS = 64;
export const MAX_SESSION_STATE_SLOT_BYTES = 64 * 1024;
export const MAX_SESSION_STATE_BYTES = 256 * 1024;

export type RuntimeSessionStateValue =
  | { readonly [key: string]: RuntimeSessionStateValue; }
  | boolean
  | number
  | readonly RuntimeSessionStateValue[]
  | string
  | null;

export interface RuntimeSessionStateEntry {
  readonly definitionVersion: number;
  readonly schemaFingerprint: string;
  readonly value: RuntimeSessionStateValue;
}

export interface RuntimeSessionStateSnapshot {
  readonly schemaVersion: typeof RUNTIME_SESSION_STATE_SCHEMA_VERSION;
  readonly revision: number;
  readonly values: Readonly<Record<string, RuntimeSessionStateEntry>>;
}

export interface RuntimeTurnInstructionSnapshot {
  readonly agentSnapshotFingerprint: string;
  readonly entries: ReadonlyArray<{
    readonly kind: "dynamic" | "static";
    readonly markdown: string;
    readonly sourcePath: string;
  }>;
  readonly fingerprint: string;
  readonly markdown: string;
  readonly turnId: string;
}

export interface RuntimeTurnCapabilitySnapshot {
  readonly agentSnapshotFingerprint: string;
  readonly connectionTools: ReadonlyArray<{
    readonly connectionName: string;
    readonly contributionId: string;
    readonly schemaFingerprint: string;
    readonly toolName: string;
  }>;
  readonly fingerprint: string;
  readonly hostPolicyFingerprint: string;
  readonly model: AgentModelSelector;
  readonly modelOptions: AgentModelOptionsDefinition;
  readonly reasoning?: ThinkingLevel;
  readonly requestFingerprint: string;
  readonly tools: ReadonlyArray<{
    readonly approval?: ApprovalRequirement;
    readonly closureVariables?: RuntimeSessionStateValue;
    readonly contributionId: string;
    readonly description: string;
    readonly executionEnvToolKind?: ExecutionEnvToolKind;
    readonly inputSchema: RuntimeSessionStateValue;
    readonly name: string;
    readonly outputSchema?: RuntimeSessionStateValue;
    readonly requiresExecutionEnv?: true;
    readonly schemaFingerprint: string;
    readonly sourcePath?: string;
    readonly stepId?: string;
  }>;
  readonly turnId: string;
}

export interface RuntimeRunConfigurationSnapshot {
  readonly id: string;
  readonly agentSnapshotFingerprint: string;
  readonly contextFingerprint: string;
  readonly executionMode: RuntimeExecutionMode;
  readonly model: AgentModelSelector;
  readonly reasoning?: ThinkingLevel;
  readonly toolConfigurationFingerprint: string;
  readonly outputContract?: {
    readonly name: string;
    readonly schemaFingerprint: string;
  };
  readonly maxStructuredOutputBytes?: number;
}

export interface RuntimeSessionSnapshot {
  readonly schemaVersion: typeof RUNTIME_SESSION_SCHEMA_VERSION;
  readonly id: string;
  readonly activeRunId: string | null;
  readonly runs: readonly RuntimeRunSnapshot[];
  readonly instructionSnapshots?: Readonly<
    Record<string, RuntimeTurnInstructionSnapshot>
  >;
  readonly capabilitySnapshots?: Readonly<
    Record<string, RuntimeTurnCapabilitySnapshot>
  >;
  readonly state?: RuntimeSessionStateSnapshot;
  readonly operationLedger?: RuntimeDurableOperationLedgerSnapshot;
  readonly approvalLedger?: RuntimeToolApprovalLedgerSnapshot;
}

export type RuntimeRunJournalEntry =
  | {
    readonly configurationId: string;
    readonly runId: string;
    readonly sequence: number;
    readonly sessionVersion: number;
    readonly state: "runningModel";
    readonly type: "runStarted";
  }
  | {
    readonly continuationFingerprint: string;
    readonly order: number;
    readonly runId: string;
    readonly sequence: number;
    readonly sessionVersion: number;
    readonly state: Exclude<RuntimeRunState, "runningModel" | "runningTools">;
    readonly type: "runCheckpointRecorded";
  }
  | {
    readonly decision: "approved" | "denied";
    readonly requestId: string;
    readonly runId: string;
    readonly sequence: number;
    readonly sessionVersion: number;
    readonly type: "toolApprovalDecided";
  }
  | {
    readonly fingerprint: string;
    readonly sequence: number;
    readonly sessionVersion: number;
    readonly turnId: string;
    readonly type: "turnCapabilitiesRecorded";
  }
  | {
    readonly fingerprint: string;
    readonly sequence: number;
    readonly sessionVersion: number;
    readonly turnId: string;
    readonly type: "turnInstructionsRecorded";
  }
  | {
    readonly from: RuntimeRunState;
    readonly runId: string;
    readonly sequence: number;
    readonly sessionVersion: number;
    readonly to: RuntimeRunState;
    readonly type: "runStateChanged";
  }
  | {
    readonly names: readonly string[];
    readonly revision: number;
    readonly sequence: number;
    readonly sessionVersion: number;
    readonly type: "sessionStateReplaced";
  }
  | {
    readonly operationId: string;
    readonly parkId: string;
    readonly runId: string;
    readonly sequence: number;
    readonly sessionVersion: number;
    readonly stepId: string;
    readonly type: "operationResumed";
  }
  | {
    readonly operationId: string;
    readonly requestFingerprint: string;
    readonly runId: string;
    readonly sequence: number;
    readonly sessionVersion: number;
    readonly state: "cancelled" | "completed" | "failed" | "outcomeUnknown";
    readonly stepId: string;
    readonly type: "operationSettled";
  }
  | {
    readonly operationId: string;
    readonly requestFingerprint: string;
    readonly runId: string;
    readonly sequence: number;
    readonly sessionVersion: number;
    readonly state: "parked" | "preCall";
    readonly stepId: string;
    readonly type: "operationStarted";
  }
  | {
    readonly requestId: string;
    readonly runId: string;
    readonly sequence: number;
    readonly sessionVersion: number;
    readonly state: "pending";
    readonly toolCallId: string;
    readonly type: "toolApprovalRequested";
  }
  | {
    readonly requestId: string;
    readonly runId: string;
    readonly sequence: number;
    readonly sessionVersion: number;
    readonly type: "toolApprovalStaled";
  }
  | {
    readonly runId: string;
    readonly sequence: number;
    readonly sessionVersion: number;
    readonly stepId: string;
    readonly type: "operationStepCheckpointed";
  };

export interface StoredRuntimeSession {
  readonly version: number;
  readonly snapshot: RuntimeSessionSnapshot;
  readonly configurations: readonly RuntimeRunConfigurationSnapshot[];
  readonly journal: readonly RuntimeRunJournalEntry[];
}

export type RuntimeSessionMutation =
  | {
    readonly agentSnapshotFingerprint: string;
    readonly contributionId: string;
    readonly currentPrincipalFingerprint: string;
    readonly hostPolicyFingerprint: string;
    readonly hostRequirement: "always" | "deny" | "never" | "once";
    readonly initiatorPrincipalFingerprint: string;
    readonly operationId: string;
    readonly reason?: string;
    readonly requestFingerprint: string;
    readonly requestId: string;
    readonly runId: string;
    readonly scope: "call" | "session";
    readonly sourcePolicyFingerprint: string;
    readonly sourceRequirement: "always" | "deny" | "never" | "once";
    readonly stepId: string;
    readonly toolCallId: string;
    readonly toolName: string;
    readonly type: "requestToolApproval";
  }
  | {
    readonly configuration: RuntimeRunConfigurationSnapshot;
    readonly runId: string;
    readonly type: "startRun";
  }
  | {
    readonly continuationFingerprint: string;
    readonly runId: string;
    readonly type: "recordCheckpoint";
  }
  | {
    readonly currentPrincipalFingerprint: string;
    readonly decision: "approved" | "denied";
    readonly initiatorPrincipalFingerprint: string;
    readonly requestId: string;
    readonly runId: string;
    readonly type: "decideToolApproval";
  }
  | {
    readonly kind: "provider" | "tool";
    readonly operationId: string;
    readonly park?: Omit<RuntimeDurableOperationPark, "parkedSessionVersion">;
    readonly provider?: string;
    readonly requestFingerprint: string;
    readonly runId: string;
    readonly stepId: string;
    readonly stepSequence: number;
    readonly toolCallId?: string;
    readonly transcriptMessageCount: number;
    readonly type: "startOperation";
  }
  | {
    readonly operationId: string;
    readonly parkId: string;
    readonly requestFingerprint: string;
    readonly resumeSchemaFingerprint: string;
    readonly runId: string;
    readonly type: "resumeOperation";
  }
  | {
    readonly operationId: string;
    readonly replay?: RuntimeDurableOperationReplayEnvelope;
    readonly requestFingerprint: string;
    readonly runId: string;
    readonly state: "cancelled" | "completed" | "failed" | "outcomeUnknown";
    readonly type: "settleOperation";
  }
  | {
    readonly requestId: string;
    readonly runId: string;
    readonly type: "staleToolApproval";
  }
  | {
    readonly runId: string;
    readonly stepId: string;
    readonly type: "checkpointOperationStep";
  }
  | {
    readonly runId: string;
    readonly structuredOutput?: RuntimeStructuredOutputResult;
    readonly to: RuntimeRunState;
    readonly type: "transitionRun";
  }
  | {
    readonly snapshot: RuntimeTurnCapabilitySnapshot;
    readonly type: "recordTurnCapabilities";
  }
  | {
    readonly snapshot: RuntimeTurnInstructionSnapshot;
    readonly type: "recordTurnInstructions";
  }
  | {
    readonly type: "replaceState";
    readonly values: Readonly<Record<string, RuntimeSessionStateEntry>>;
  };

export interface SessionStoreCommit {
  readonly sessionId: string;
  readonly expectedVersion: number | null;
  readonly mutations: readonly RuntimeSessionMutation[];
}

export interface SessionStore {
  load(sessionId: string): Promise<StoredRuntimeSession | null>;
  commit(input: SessionStoreCommit): Promise<StoredRuntimeSession>;
}

export class SessionStoreConflictError extends Error {
  readonly sessionId: string;
  readonly expectedVersion: number | null;
  readonly actualVersion: number | null;

  constructor(
    sessionId: string,
    expectedVersion: number | null,
    actualVersion: number | null
  ) {
    super(
      `Session Store version conflict for ${sessionId}: expected ${String(expectedVersion)}, actual ${String(actualVersion)}`
    );
    this.name = "SessionStoreConflictError";
    this.sessionId = sessionId;
    this.expectedVersion = expectedVersion;
    this.actualVersion = actualVersion;
  }
}

export class SessionStoreInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionStoreInvariantError";
  }
}
