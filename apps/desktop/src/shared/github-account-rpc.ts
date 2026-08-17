import type { GithubAuthState } from "./auth";
import { defineRpcNamespace } from "./namespaced-rpc";

export const GITHUB_ACCOUNT_SERVICE = Symbol("GithubAccountService");

export interface GithubAccountRequests {
  getState(): Promise<GithubAuthState>;
  signIn(): Promise<void>;
  signOut(): Promise<void>;
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
    requests: { getState: true, signIn: true, signOut: true },
    streams: {},
    events: { changed: true },
  }
);
