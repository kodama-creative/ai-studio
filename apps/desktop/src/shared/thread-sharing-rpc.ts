import type { PortableThreadSnapshot } from "@llm-space/core";
import type { Playground } from "@llm-space/studio";

import { defineRpcNamespace } from "./namespaced-rpc";

export interface ThreadSharingRequests {
  read(playgroundId: string): Promise<PortableThreadSnapshot>;
  publish(
    playgroundId: string,
    meta?: { title?: string; description?: string }
  ): Promise<{ shareUrl: string; gistId: string }>;
  importSnapshot(snapshot: PortableThreadSnapshot): Promise<Playground>;
  importGist(gistId: string): Promise<Playground>;
}

export interface ThreadSharingRpc {
  readonly requests: ThreadSharingRequests;
  readonly streams: Record<never, never>;
  readonly events: Record<never, never>;
}

export const THREAD_SHARING_RPC = defineRpcNamespace<ThreadSharingRpc>(
  "threadSharing",
  {
    requests: {
      read: true,
      publish: true,
      importSnapshot: true,
      importGist: true,
    },
    streams: {},
    events: {},
  }
);
