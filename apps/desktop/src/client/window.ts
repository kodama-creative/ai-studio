import { createRpcClient } from "@/shared/namespaced-rpc";
import { WINDOW_RPC } from "@/shared/window-rpc";

import { createElectrobunRpcClientTransport } from "./namespaced-rpc-client";

/** Create one typed Window namespace proxy for its owning renderer module. */
export function createWindowClient() {
  return createRpcClient(WINDOW_RPC, createElectrobunRpcClientTransport());
}
