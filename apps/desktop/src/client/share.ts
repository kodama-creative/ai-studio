import type { Thread } from "@llm-space/core";

import type { RuntimeId } from "@/shared/runtime";

import { threadSharingClient } from "./application-rpc-clients";

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

/** Read the thread selected for sharing from its owning runtime. */
export function readShareThread(
  runtimeId: RuntimeId,
  path: string
): Promise<Thread> {
  return threadSharingClient.read(runtimeId, path);
}

/**
 * Publish a workspace thread as a secret GitHub Gist and return its shareable
 * web link. Requires GitHub sign-in (the bun side throws otherwise); each call
 * creates a fresh gist. `meta.title`/`meta.description` set the shared copy's
 * viewer metadata.
 */
export async function shareThread(
  runtimeId: RuntimeId,
  path: string,
  meta?: ShareThreadMeta
): Promise<ShareThreadResult> {
  return threadSharingClient.publish(runtimeId, path, meta);
}
