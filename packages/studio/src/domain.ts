import type { AgentSnapshot, Run, ThreadState } from "@llm-space/engine";

/** Editable Studio document. Conversation is a core Message-based ThreadState. */
export interface StudioThreadDocument {
  readonly title: string;
  readonly agent: AgentSnapshot;
  readonly conversation: ThreadState;
  readonly commitId: string;
}

/**
 * Studio Experiment read model.
 *
 * Only experiment metadata and an optional dirty Draft are Studio-owned. The
 * returned document is composed from that Draft or Engine's head Checkpoint.
 */
export interface StudioThread {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly engineThreadId: string;
  readonly headCheckpointId: string;
  readonly document: StudioThreadDocument;
  readonly provenance?: {
    readonly type: "fork";
    readonly threadId: string;
    readonly checkpointId?: string;
  };
  readonly activeRunId?: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

/** Internal persisted Studio metadata; `draft` exists only while UI edits are dirty. */
export interface StudioExperimentRecord {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly engineThreadId: string;
  readonly title: string;
  readonly agent: AgentSnapshot;
  readonly commitId: string;
  readonly draft?: ThreadState;
  readonly pendingRun?: {
    readonly operationId: string;
    readonly createdAt: number;
  };
  readonly provenance?: StudioThread["provenance"];
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface ThreadCheckpoint {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly threadId: string;
  readonly source: import("@llm-space/engine").CheckpointSource;
  readonly document: StudioThreadDocument;
  readonly createdAt: number;
}

export interface ThreadRunReference {
  readonly threadId: string;
  readonly runId: string;
  readonly checkpointId?: string;
  readonly relation: "executed" | "inherited";
}

export interface StudioRunHistoryEntry {
  readonly reference: ThreadRunReference;
  readonly run: Run;
  readonly checkpoint?: ThreadCheckpoint;
}

export interface StudioRunReceipt {
  readonly runId: string;
}

export type StudioThreadEventData =
  | { readonly type: "run.started"; readonly run: Run }
  | {
      readonly type: "message.delta";
      readonly runId: string;
      readonly messageId: string;
      readonly delta: string;
    }
  | {
      readonly type: "conversation.updated";
      readonly runId: string;
      readonly thread: StudioThread;
    }
  | { readonly type: "run.completed"; readonly runId: string }
  | {
      readonly type: "run.failed";
      readonly runId: string;
      readonly message: string;
    }
  | { readonly type: "run.cancelled"; readonly runId: string };

export interface StudioThreadEvent {
  readonly threadId: string;
  readonly sequence: number;
  readonly timestamp: number;
  readonly event: StudioThreadEventData;
}

export interface StudioEventCursor {
  readonly afterSequence?: number;
  readonly follow?: boolean;
  readonly signal?: AbortSignal;
}
