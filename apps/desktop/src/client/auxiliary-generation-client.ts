import {
  AUXILIARY_GENERATION_RPC,
  type AuxiliaryGenerationRpc,
} from "../shared/auxiliary-generation-rpc";
import { createRpcClient, type RpcClient } from "../shared/namespaced-rpc";

import { createElectrobunRpcClientTransport } from "./namespaced-rpc-client";

/** Desktop client for stateless text generation outside product Sessions. */
export function createAuxiliaryGenerationClient(): RpcClient<AuxiliaryGenerationRpc> {
  return createRpcClient(
    AUXILIARY_GENERATION_RPC,
    createElectrobunRpcClientTransport()
  );
}
