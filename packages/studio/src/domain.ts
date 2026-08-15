import type { PiOperationSnapshot } from "@llm-space/pi-runtime";

import type {
  StudioAgentSnapshot,
  StudioConversation,
  StudioOperationReceipt,
  StudioOperationReference,
  StudioPiIdentity,
  StudioStepInput,
} from "./pi-domain";

/** Editable Project Experiment document; Pi owns every committed message. */
export interface StudioThreadDocument {
  readonly title: string;
  readonly agent: StudioAgentSnapshot;
  readonly conversation: StudioConversation;
}

/** Project Experiment read model composed from metadata and one Pi Session. */
export interface StudioThread extends StudioPiIdentity {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly document: StudioThreadDocument;
  readonly provenance?: {
    readonly type: "fork";
    readonly threadId: string;
    readonly entryId?: string;
  };
  readonly createdAt: number;
  readonly updatedAt: number;
}

/** Studio-owned metadata; Draft is the only editable transcript projection. */
export interface StudioExperimentRecord {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly sessionId: string;
  readonly lane: "main";
  readonly runtimeFormatVersion: 1;
  readonly title: string;
  readonly agent: StudioAgentSnapshot;
  readonly state: StudioConversation["state"];
  readonly draft?: StudioConversation;
  readonly provenance?: StudioThread["provenance"];
  readonly createdAt: number;
  readonly updatedAt: number;
}

export type ProjectExperiment = StudioExperimentRecord;

/** Historical editor projection at a Pi operation leaf. */
export interface ThreadCheckpoint {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly sessionId: string;
  readonly operationId: string;
  readonly document: StudioThreadDocument;
  readonly createdAt: number;
}

export type ThreadRunReference = StudioOperationReference;

export interface StudioRunHistoryEntry {
  readonly reference: StudioOperationReference;
  readonly operation: PiOperationSnapshot;
  readonly checkpoint?: ThreadCheckpoint;
}

export type StudioRunReceipt = StudioOperationReceipt;

export type StudioRunInput = {
  readonly fromMessageId: string;
  /** Stable admission identity used to reconcile Pi/Studio crash windows. */
  readonly commandId: string;
  readonly signal?: AbortSignal;
  /** Studio-only Pi model override frozen into this operation binding. */
  readonly modelOverride?: string;
} & (
  | { readonly mode?: undefined }
  | {
      readonly mode: "step" | "continue";
    }
);

export type StudioStepRunInput = StudioStepInput;

export type StudioThreadEventData =
  | {
      readonly type: "operation.started";
      readonly operationId: string;
      readonly sessionId: string;
    }
  | {
      readonly type: "conversation.updated";
      readonly operationId: string;
      readonly thread: StudioThread;
    }
  | {
      readonly type: "operation.paused";
      readonly operationId: string;
    }
  | {
      readonly type: "operation.completed";
      readonly operationId: string;
    }
  | {
      readonly type: "operation.failed";
      readonly operationId: string;
      readonly message: string;
    }
  | {
      readonly type: "operation.aborted";
      readonly operationId: string;
    };

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
