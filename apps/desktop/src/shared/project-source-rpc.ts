import type {
  ProjectSourceSnapshot,
} from "@llm-space/studio";

import { defineRpcNamespace } from "./namespaced-rpc";

/** Project source browsing owned by the Studio window, separate from Threads. */
export interface ProjectSourceRpc {
  readonly requests: ProjectSourceRequests;
  readonly streams: ProjectSourceStreams;
  readonly events: Record<never, never>;
}

export interface ProjectSourceRequests {
  readSourceFile(path: string): Promise<string>;
}

export interface ProjectSourceStreams {
  watchSourceFiles(input?: {
    readonly signal?: AbortSignal;
  }): AsyncIterable<ProjectSourceSnapshot>;
}

export type ProjectSourceTransport = ProjectSourceRequests &
  ProjectSourceStreams;

export const PROJECT_SOURCE_RPC = defineRpcNamespace<ProjectSourceRpc>(
  "projectSource",
  {
    requests: { readSourceFile: true },
    streams: { watchSourceFiles: true },
    events: {},
  }
);

export type { ProjectSourceNode, ProjectSourceSnapshot } from "@llm-space/studio";
