import type { GithubAuthState } from "@/shared/auth";

import { githubAccountClient } from "./application-rpc-clients";

/** The current GitHub sign-in state, pulled once on mount. */
export async function getGithubAuthStatus(): Promise<GithubAuthState> {
  return githubAccountClient.getState();
}

export { githubAccountClient };
