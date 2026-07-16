import type { ThinkingLevel } from "@earendil-works/pi-agent-core";

import type { RuntimeRunSnapshot, RuntimeRunState } from "./runtime-run";
import type { AgentModelSelector } from "../../shared/agent-definition";
import type { RuntimeExecutionMode } from "../../shared/runtime-execution-mode";

export const RUNTIME_SESSION_SCHEMA_VERSION = 1 as const;

export interface RuntimeRunConfigurationSnapshot {
  readonly id: string;
  readonly agentSnapshotFingerprint: string;
  readonly contextFingerprint: string;
  readonly executionMode: RuntimeExecutionMode;
  readonly model: AgentModelSelector;
  readonly reasoning?: ThinkingLevel;
  readonly toolConfigurationFingerprint: string;
}

export interface RuntimeSessionSnapshot {
  readonly schemaVersion: typeof RUNTIME_SESSION_SCHEMA_VERSION;
  readonly id: string;
  readonly activeRunId: string | null;
  readonly runs: readonly RuntimeRunSnapshot[];
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
    readonly from: RuntimeRunState;
    readonly runId: string;
    readonly sequence: number;
    readonly sessionVersion: number;
    readonly to: RuntimeRunState;
    readonly type: "runStateChanged";
  };

export interface StoredRuntimeSession {
  readonly version: number;
  readonly snapshot: RuntimeSessionSnapshot;
  readonly configurations: readonly RuntimeRunConfigurationSnapshot[];
  readonly journal: readonly RuntimeRunJournalEntry[];
}

export type RuntimeSessionMutation =
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
    readonly runId: string;
    readonly to: RuntimeRunState;
    readonly type: "transitionRun";
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
