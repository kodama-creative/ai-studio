import type {
  CreatePlaygroundInput,
  Playground,
  SavePlaygroundInput,
} from "@llm-space/studio";

import { defineRpcNamespace } from "./namespaced-rpc";

export const PLAYGROUND_SERVICE = Symbol("PlaygroundService");

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
}

export type PlaygroundStreams = Record<never, never>;

export type PlaygroundClient = PlaygroundRequests & PlaygroundStreams;

export const PLAYGROUND_RPC = defineRpcNamespace<PlaygroundRpc>("playground", {
  requests: { list: true, create: true, load: true, save: true },
  streams: {},
  events: {},
});
