import type {
  ProjectSourceNode,
  ProjectSourceSnapshot,
  StudioEventCursor,
  StudioRunHistoryEntry,
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
    input?: { readonly entryId?: string }
  ): Promise<StudioThread>;
  createThread(input?: { readonly title?: string }): Promise<StudioThread>;
  loadThread(threadId: string): Promise<StudioThread | undefined>;
  saveDocument(
    threadId: string,
    document: StudioThreadDocument
  ): Promise<StudioThread>;
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
  "studio",
  {
    requests: {
      getSourceRevision: true,
      listSourceFiles: true,
      readSourceFile: true,
      listThreads: true,
      listRunHistory: true,
      saveRunHistory: true,
      listEvaluationMetadata: true,
      saveEvaluationMetadata: true,
      forkThread: true,
      createThread: true,
      loadThread: true,
      saveDocument: true,
    },
    streams: { watchSourceFiles: true, events: true },
    events: {},
  }
);

export type { ProjectSourceNode, ProjectSourceSnapshot };
