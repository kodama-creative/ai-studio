import type { LocalFileSystem } from "@llm-space/core/server";
import type { ThreadStorageRegistry } from "@llm-space/runtime/plugins";

import type { Disposable } from "../../shared/disposable";
import { EventHub } from "../../shared/event-hub";
import type { SharedImportStatusPayload } from "../../shared/shared-import";
import type { GitHubAuthManager } from "../auth/github-auth-manager";
import { createDeepLinkHandler, type DeepLinkHandler } from "../deep-link";

/** Owns shared-thread import execution, cancellation, and UI status events. */
export interface SharedImportApplicationApi {
  cancel(): Promise<void>;
}
export interface SharedImportApplicationEvents {
  statusChanged: SharedImportStatusPayload;
}

export class SharedImportApplication
  implements SharedImportApplicationApi, Disposable
{
  readonly events = new EventHub<SharedImportApplicationEvents>();
  private readonly _handler: DeepLinkHandler;

  constructor(input: {
    localFs: LocalFileSystem;
    githubAuth: GitHubAuthManager;
    threadStorages: ThreadStorageRegistry;
    openAgentProject: (rootPath: string) => Promise<void>;
  }) {
    this._handler = createDeepLinkHandler({
      ...input,
      notifySharedImport: (payload) =>
        this.events.publish("statusChanged", payload),
    });
  }

  /** Route one desktop deep link into project opening or shared import. */
  handle(url: string): Promise<void> {
    return this._handler.handle(url);
  }

  /** Abort only the currently active shared import. */
  cancel(): Promise<void> {
    this._handler.cancel();
    return Promise.resolve();
  }

  /** Cancel in-flight import work before releasing its status listeners. */
  dispose(): void {
    this._handler.cancel();
    this.events.dispose();
  }
}
