import { createRpcClient } from "@/shared/namespaced-rpc";
import { UPDATES_RPC } from "@/shared/updates-rpc";

import { createElectrobunRpcClientTransport } from "./namespaced-rpc-client";

/** Create one typed Updates namespace proxy for its owning renderer module. */
export function createUpdatesClient() {
  return createRpcClient(UPDATES_RPC, createElectrobunRpcClientTransport());
}
