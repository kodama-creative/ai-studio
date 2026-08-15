import type { GithubAuthState } from "./auth";
import { defineRpcNamespace } from "./namespaced-rpc";

export interface GithubAccountRequests {
  getState(): Promise<GithubAuthState>;
}

export interface GithubAccountEvents {
  changed: GithubAuthState;
}

export interface GithubAccountRpc {
  readonly requests: GithubAccountRequests;
  readonly streams: Record<never, never>;
  readonly events: GithubAccountEvents;
}

export const GITHUB_ACCOUNT_RPC = defineRpcNamespace<GithubAccountRpc>(
  "githubAccount",
  {
    requests: { getState: true },
    streams: {},
    events: { changed: true },
  }
);
