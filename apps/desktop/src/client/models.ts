import { MODELS_RPC } from "@/shared/models-rpc";
import { createRpcClient } from "@/shared/namespaced-rpc";

import { createElectrobunRpcClientTransport } from "./namespaced-rpc-client";

/** Create one typed Models namespace proxy for its owning renderer module. */
export function createModelsClient() {
  return createRpcClient(MODELS_RPC, createElectrobunRpcClientTransport());
}
