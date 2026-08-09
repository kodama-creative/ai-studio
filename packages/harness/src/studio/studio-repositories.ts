import type {
  EvaluationRepository,
  EvaluationRubricRepository,
} from "../evaluation";
import type { Run } from "../run";

import type { StudioThread } from "./studio-thread";
import type { ThreadCheckpoint } from "./thread-checkpoint";

export interface StudioThreadRepository {
  create(thread: StudioThread): Promise<"created" | "existing">;
  load(threadId: string): Promise<StudioThread | undefined>;
  save(thread: StudioThread): Promise<void>;
  list(): Promise<readonly StudioThread[]>;
}

export interface ThreadCheckpointRepository {
  create(checkpoint: ThreadCheckpoint): Promise<"created" | "existing">;
  load(checkpointId: string): Promise<ThreadCheckpoint | undefined>;
  listByThread(threadId: string): Promise<readonly ThreadCheckpoint[]>;
}

export interface ThreadRunReference {
  readonly threadId: string;
  readonly runId: string;
  readonly checkpointId?: string;
  readonly relation: "executed" | "inherited";
}

export interface ThreadRunIndexRepository {
  append(reference: ThreadRunReference): Promise<void>;
  replace(
    threadId: string,
    references: readonly ThreadRunReference[]
  ): Promise<void>;
  list(threadId: string): Promise<readonly ThreadRunReference[]>;
}

export interface StudioStorage {
  readonly threadRepository: StudioThreadRepository;
  readonly runRepository: import("../run").RunRepository;
  readonly evaluationRepository: EvaluationRepository;
  readonly evaluationRubricRepository: EvaluationRubricRepository;
  readonly checkpointRepository: ThreadCheckpointRepository;
  readonly runIndexRepository: ThreadRunIndexRepository;
  readonly eventLog: StudioThreadEventLog;
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
  | { readonly type: "run.failed"; readonly runId: string; readonly message: string }
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

export interface StudioThreadEventLog {
  append(event: StudioThreadEvent): Promise<void>;
  read(
    threadId: string,
    cursor?: StudioEventCursor
  ): AsyncIterable<StudioThreadEvent>;
}
