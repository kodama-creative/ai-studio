import { GITHUB_ACCOUNT_RPC } from "@/shared/github-account-rpc";
import { createRpcClient } from "@/shared/namespaced-rpc";

import { createElectrobunRpcClientTransport } from "./namespaced-rpc-client";

/** Create one typed GitHub Account proxy for its owning renderer module. */
export function createGithubAccountClient() {
  return createRpcClient(
    GITHUB_ACCOUNT_RPC,
    createElectrobunRpcClientTransport()
  );
}
