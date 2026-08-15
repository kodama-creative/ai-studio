import { createRpcClient } from "@/shared/namespaced-rpc";
import { UPDATES_RPC } from "@/shared/updates-rpc";

import { createElectrobunRpcClientTransport } from "./namespaced-rpc-client";

/** Renderer client owned by the Updates RPC feature. */
export const updatesClient = createRpcClient(
  UPDATES_RPC,
  createElectrobunRpcClientTransport()
);
