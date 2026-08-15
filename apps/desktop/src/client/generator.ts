import { GENERATOR_RPC } from "@/shared/generator-rpc";
import { createRpcClient } from "@/shared/namespaced-rpc";

import { createElectrobunRpcClientTransport } from "./namespaced-rpc-client";

/** Create one typed Generator namespace proxy for its owning renderer module. */
export function createGeneratorClient() {
  return createRpcClient(GENERATOR_RPC, createElectrobunRpcClientTransport());
}
