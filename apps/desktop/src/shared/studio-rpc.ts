import type {
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

export const STUDIO_SERVICE = Symbol("StudioService");

/** Studio Thread metadata and Draft contract; execution lives in `acpSession.*`. */
export interface StudioRpc {
  readonly requests: StudioRequests;
  readonly streams: StudioStreams;
  readonly events: Record<never, never>;
}

export interface StudioRequests {
  listThreads(): Promise<readonly StudioThread[]>;
  listRunHistory(threadId: string): Promise<readonly StudioRunHistoryEntry[]>;
  saveRunHistory(
    threadId: string,
    operationIds: readonly string[]
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

export interface StudioStreams {
  events(
    threadId: string,
    cursor?: StudioEventCursor
  ): AsyncIterable<StudioThreadEvent>;
}

export type StudioTransport = StudioRequests & StudioStreams;

export const STUDIO_RPC = defineRpcNamespace<StudioRpc>("studio", {
  requests: {
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
  streams: { events: true },
  events: {},
});
