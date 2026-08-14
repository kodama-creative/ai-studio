import type { RunEventCursor, RunFrame } from "@llm-space/engine";
import type {
  CreatePlaygroundInput,
  Playground,
  RunPlaygroundInput,
  SavePlaygroundInput,
  StudioRunReceipt,
} from "@llm-space/studio";

import { defineRpcNamespace } from "./namespaced-rpc";

/** Shared contract for the main-window Playground application module. */
export interface PlaygroundRpc {
  readonly requests: PlaygroundRequests;
  readonly streams: PlaygroundStreams;
  readonly events: Record<never, never>;
}

export interface PlaygroundRequests {
  list(): Promise<readonly Playground[]>;
  create(input: CreatePlaygroundInput): Promise<Playground>;
  load(playgroundId: string): Promise<Playground | undefined>;
  save(
    playgroundId: string,
    document: SavePlaygroundInput
  ): Promise<Playground>;
  run(
    playgroundId: string,
    input: RunPlaygroundInput
  ): Promise<StudioRunReceipt>;
  stepRun(
    runId: string,
    input?: { readonly toolCallId?: string }
  ): Promise<StudioRunReceipt>;
  continueRun(runId: string): Promise<StudioRunReceipt>;
  cancelRun(runId: string): Promise<void>;
}

export interface PlaygroundStreams {
  streamRun(runId: string, cursor?: RunEventCursor): AsyncIterable<RunFrame>;
}

export type PlaygroundClient = PlaygroundRequests & PlaygroundStreams;

export const PLAYGROUND_RPC = defineRpcNamespace<PlaygroundRpc>("playground", {
  streams: ["streamRun"],
  events: [],
});
