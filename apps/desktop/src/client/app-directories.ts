import { APP_DIRECTORIES_RPC } from "@/shared/app-directories-rpc";
import { createRpcClient } from "@/shared/namespaced-rpc";

import { createElectrobunRpcClientTransport } from "./namespaced-rpc-client";

/** Create one typed App Directories proxy for its owning renderer module. */
export function createAppDirectoriesClient() {
  return createRpcClient(
    APP_DIRECTORIES_RPC,
    createElectrobunRpcClientTransport()
  );
}
