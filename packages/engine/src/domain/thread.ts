import type { JsonValue, Message } from "@llm-space/core";

export interface ThreadParent {
  readonly threadId: string;
  readonly relationship: "retry" | "fork";
  readonly sourceCheckpointId: string;
}

/**
 * Stable identity for one resumable Agent state line.
 *
 * The current state is never duplicated on Thread; `headCheckpointId` is the
 * only pointer to it. A root Thread has no parent.
 */
export interface Thread {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly parent?: ThreadParent;
  readonly headCheckpointId: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

/** State required to continue a Thread from one immutable Checkpoint. */
export interface ThreadState {
  /** Current model context. Compaction may replace this list in the future. */
  readonly messages: readonly Message[];
  /** Agent-defined JSON state restored across Runs. */
  readonly state: Readonly<Record<string, JsonValue>>;
}

export type CheckpointSource =
  | { readonly type: "thread.created" }
  | {
      readonly type: "thread.forked";
      readonly sourceThreadId: string;
      readonly sourceCheckpointId: string;
    }
  | { readonly type: "run.input"; readonly runId: string }
  | {
      readonly type: "run.step";
      readonly runId: string;
      readonly step: "model.completed" | "tool.completed";
    }
  | { readonly type: "run.recovery"; readonly runId: string }
  | { readonly type: "manual" };

/** Immutable, monotonically sequenced Thread state snapshot. */
export interface ThreadCheckpoint {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly threadId: string;
  readonly parentCheckpointId?: string;
  readonly sequence: number;
  readonly source: CheckpointSource;
  readonly threadState: ThreadState;
  readonly createdAt: number;
}
