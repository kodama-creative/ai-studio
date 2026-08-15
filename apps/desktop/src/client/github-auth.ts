import type { GithubAuthState } from "@/shared/auth";
import { GITHUB_ACCOUNT_RPC } from "@/shared/github-account-rpc";
import { createRpcClient } from "@/shared/namespaced-rpc";

import { createElectrobunRpcClientTransport } from "./namespaced-rpc-client";

/** Renderer client owned by the GitHub Account RPC feature. */
export const githubAccountClient = createRpcClient(
  GITHUB_ACCOUNT_RPC,
  createElectrobunRpcClientTransport()
);

/** The current GitHub sign-in state, pulled once on mount. */
export async function getGithubAuthStatus(): Promise<GithubAuthState> {
  return githubAccountClient.getState();
}
