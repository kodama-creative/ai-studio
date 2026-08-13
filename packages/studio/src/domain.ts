import type { AssistantMessage } from "@llm-space/core";
import type {
  AgentSnapshot,
  Run,
  RunExecutionMode,
  ThreadState,
} from "@llm-space/engine";

/** Editable Studio document. Conversation is a core Message-based ThreadState. */
export interface StudioThreadDocument {
  readonly title: string;
  readonly agent: AgentSnapshot;
  readonly conversation: ThreadState;
  /** Legacy persisted field; new Runs clear it and always use live source. */
  readonly commitId?: string;
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
  /** Legacy persisted field retained only while reading pre-live-source data. */
  readonly commitId?: string;
  readonly draft?: ThreadState;
  readonly pendingRun?: {
    readonly operationId: string;
    readonly createdAt: number;
  };
  readonly provenance?: StudioThread["provenance"];
  readonly createdAt: number;
  readonly updatedAt: number;
}

/** Preferred domain name for new code; StudioThread remains an outward adapter. */
export type ProjectExperiment = StudioExperimentRecord;

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

export interface StudioRunInput {
  readonly fromMessageId: string;
  /** Studio-only model selection frozen onto this Run; Agent source is unchanged. */
  readonly modelOverride?: string;
  readonly mode?: RunExecutionMode;
}

export interface StudioStepRunInput {
  readonly toolCallId?: string;
}

export type StudioThreadEventData =
  | { readonly type: "run.started"; readonly run: Run }
  | { readonly type: "run.paused"; readonly run: Run }
  | {
      readonly type: "message.delta";
      readonly runId: string;
      readonly messageId: string;
      readonly delta: string;
    }
  | {
      readonly type: "thinking.delta";
      readonly runId: string;
      readonly messageId: string;
      readonly delta: string;
    }
  | {
      readonly type: "message.completed";
      readonly runId: string;
      readonly message: AssistantMessage;
    }
  | {
      readonly type: "tool.started";
      readonly runId: string;
      readonly messageId: string;
      readonly toolCallId: string;
      readonly toolName: string;
    }
  | {
      readonly type: "tool.updated";
      readonly runId: string;
      readonly messageId: string;
      readonly toolCallId: string;
      readonly message: AssistantMessage;
    }
  | {
      readonly type: "tool.completed";
      readonly runId: string;
      readonly messageId: string;
      readonly toolCallId: string;
      readonly message: AssistantMessage;
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
