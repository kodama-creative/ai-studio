import type {
  ProjectSourceNode,
  ProjectSourceSnapshot,
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

import { defineRpcNamespace } from "./namespaced-rpc";

/** Shared Project Studio contract implemented by RPC server and client proxy. */
export interface ProjectStudioRpc {
  readonly requests: ProjectStudioRequests;
  readonly streams: ProjectStudioStreams;
  readonly events: Record<never, never>;
}

export interface ProjectStudioRequests {
  getSourceRevision(): Promise<string>;
  listSourceFiles(): Promise<readonly ProjectSourceNode[]>;
  readSourceFile(path: string): Promise<string>;
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
  run(threadId: string, input: StudioRunInput): Promise<StudioRunReceipt>;
  stepRun(runId: string, input?: StudioStepRunInput): Promise<StudioRunReceipt>;
  continueRun(runId: string): Promise<StudioRunReceipt>;
  cancelRun(runId: string): Promise<void>;
}

export interface ProjectStudioStreams {
  watchSourceFiles(input?: {
    readonly signal?: AbortSignal;
  }): AsyncIterable<ProjectSourceSnapshot>;
  events(
    threadId: string,
    cursor?: StudioEventCursor
  ): AsyncIterable<StudioThreadEvent>;
}

export type ProjectStudioTransport = ProjectStudioRequests &
  ProjectStudioStreams;

export const PROJECT_STUDIO_RPC = defineRpcNamespace<ProjectStudioRpc>(
  "project",
  { streams: ["watchSourceFiles", "events"], events: [] }
);

export type { ProjectSourceNode, ProjectSourceSnapshot };
