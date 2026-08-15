import { MODELS_RPC } from "@/shared/models-rpc";
import { createRpcClient } from "@/shared/namespaced-rpc";

import { createElectrobunRpcClientTransport } from "./namespaced-rpc-client";

/** Renderer client owned by the Models RPC feature. */
export const modelsClient = createRpcClient(
  MODELS_RPC,
  createElectrobunRpcClientTransport()
);
