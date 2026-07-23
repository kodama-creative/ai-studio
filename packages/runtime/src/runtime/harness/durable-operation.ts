import type { RuntimeJsonValue } from "./runtime-run";

export const RUNTIME_OPERATION_LEDGER_SCHEMA_VERSION = 1 as const;
export const MAX_DURABLE_OPERATION_REPLAY_BYTES = 1024 * 1024;
export const MAX_DURABLE_STEP_REPLAY_BYTES = 4 * 1024 * 1024;

export const RUNTIME_DURABLE_OPERATION_STATES = [
  "preCall",
  "completed",
  "failed",
  "cancelled",
  "parked",
  "outcomeUnknown"
] as const;

export type RuntimeDurableOperationState =
  typeof RUNTIME_DURABLE_OPERATION_STATES[number];

export interface RuntimeDurableOperationReplayEnvelope {
  readonly byteLength: number;
  readonly resultFingerprint: string;
  readonly value: RuntimeJsonValue;
}

export interface RuntimeDurableOperationPark {
  readonly parkId: string;
  readonly parkedSessionVersion: number;
  readonly reason: string;
  readonly resumeSchemaFingerprint: string;
}

export interface RuntimeDurableOperationSnapshot {
  readonly attempt: number;
  readonly id: string;
  readonly idempotency: { readonly mode: "none"; };
  readonly kind: "provider" | "tool";
  readonly requestFingerprint: string;
  readonly replayByteLength?: number;
  readonly resultFingerprint?: string;
  readonly runId: string;
  readonly settledAt?: number;
  readonly startedAt: number;
  readonly state: RuntimeDurableOperationState;
  readonly stepId: string;
  readonly toolCallId?: string;
  readonly provider?: string;
  readonly replay?: RuntimeDurableOperationReplayEnvelope;
  readonly park?: RuntimeDurableOperationPark;
}

export interface RuntimeDurableStepSnapshot {
  readonly id: string;
  readonly operations: readonly RuntimeDurableOperationSnapshot[];
  readonly runId: string;
  readonly sequence: number;
  readonly state: "active" | "checkpointed";
  readonly transcriptMessageCount: number;
}

export interface RuntimeDurableOperationLedgerSnapshot {
  readonly schemaVersion: typeof RUNTIME_OPERATION_LEDGER_SCHEMA_VERSION;
  readonly steps: readonly RuntimeDurableStepSnapshot[];
}
