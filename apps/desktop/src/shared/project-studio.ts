import type {
  StudioEventCursor,
  StudioRunReceipt,
  StudioRunHistoryEntry,
  StudioRunInput,
  StudioStepRunInput,
  StudioThread,
  StudioThreadDocument,
  StudioThreadEvent,
} from "@llm-space/studio";
import type {
  StudioEvaluationMetadata,
  StudioEvaluationMetadataInput,
} from "@llm-space/studio/evaluation";

export interface ProjectStudioTransport {
  getSourceRevision(): Promise<string>;
  listSourceFiles(): Promise<readonly ProjectSourceNode[]>;
  readSourceFile(path: string): Promise<string>;
  watchSourceFiles(input?: {
    readonly signal?: AbortSignal;
  }): AsyncIterable<ProjectSourceSnapshot>;
  listThreads(): Promise<readonly StudioThread[]>;
  listRunHistory(threadId: string): Promise<readonly StudioRunHistoryEntry[]>;
  saveRunHistory(
    threadId: string,
    runIds: readonly string[]
  ): Promise<readonly StudioRunHistoryEntry[]>;
  listEvaluationMetadata(threadId: string): Promise<StudioEvaluationMetadata>;
  saveEvaluationMetadata(
    threadId: string,
    input: StudioEvaluationMetadataInput
  ): Promise<StudioEvaluationMetadata>;
  forkThread(
    threadId: string,
    input?: { readonly checkpointId?: string }
  ): Promise<StudioThread>;
  createThread(input?: { readonly title?: string }): Promise<StudioThread>;
  loadThread(threadId: string): Promise<StudioThread | undefined>;
  saveDocument(
    threadId: string,
    document: StudioThreadDocument
  ): Promise<StudioThread>;
  run(
    threadId: string,
    input: StudioRunInput
  ): Promise<StudioRunReceipt>;
  stepRun(
    runId: string,
    input?: StudioStepRunInput
  ): Promise<StudioRunReceipt>;
  continueRun(runId: string): Promise<StudioRunReceipt>;
  cancelRun(runId: string): Promise<void>;
  events(
    threadId: string,
    cursor?: StudioEventCursor
  ): AsyncIterable<StudioThreadEvent>;
}

export interface ProjectSourceNode {
  readonly name: string;
  readonly path: string;
  readonly type: "file" | "directory";
  readonly children?: readonly ProjectSourceNode[];
}

export interface ProjectSourceSnapshot {
  readonly files: readonly ProjectSourceNode[];
  readonly revision: string;
}
