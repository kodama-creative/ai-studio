import type { PortableThreadSnapshot } from "@llm-space/core";
import type { Playground } from "@llm-space/studio";

import { createRpcClient } from "@/shared/namespaced-rpc";
import { THREAD_SHARING_RPC } from "@/shared/thread-sharing-rpc";

import { createElectrobunRpcClientTransport } from "./namespaced-rpc-client";

/** Renderer client owned by the Thread Sharing RPC feature. */
const threadSharingClient = createRpcClient(
  THREAD_SHARING_RPC,
  createElectrobunRpcClientTransport()
);

/** The result of publishing a thread: the web viewer link + the gist id. */
export interface ShareThreadResult {
  shareUrl: string;
  gistId: string;
}

/** Optional display metadata for the shared copy (does not touch the local file). */
export interface ShareThreadMeta {
  title?: string;
  description?: string;
}

/** Read the selected Playground projection as a portable Thread snapshot. */
export function readShareThread(
  playgroundId: string
): Promise<PortableThreadSnapshot> {
  return threadSharingClient.read(playgroundId);
}

/**
 * Publish a Playground Thread snapshot as a secret GitHub Gist and return its
 * shareable
 * web link. Requires GitHub sign-in (the bun side throws otherwise); each call
 * creates a fresh gist. `meta.title`/`meta.description` set the shared copy's
 * viewer metadata.
 */
export async function shareThread(
  playgroundId: string,
  meta?: ShareThreadMeta
): Promise<ShareThreadResult> {
  return threadSharingClient.publish(playgroundId, meta);
}

export function importThreadSnapshot(
  snapshot: PortableThreadSnapshot
): Promise<Playground> {
  return threadSharingClient.importSnapshot(snapshot);
}

export function importGistThread(gistId: string): Promise<Playground> {
  return threadSharingClient.importGist(gistId);
}
