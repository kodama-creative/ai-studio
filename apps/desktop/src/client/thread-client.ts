import { createRpcClient, type RpcClient } from "../shared/namespaced-rpc";
import { THREAD_RPC, type ThreadClient, type ThreadRpc } from "../shared/thread-rpc";

import { createElectrobunRpcClientTransport } from "./namespaced-rpc-client";

/** Creates the renderer client for product-owned Thread execution commands. */
export function createThreadClient(): ThreadClient {
  const client: RpcClient<ThreadRpc> = createRpcClient(
    THREAD_RPC,
    createElectrobunRpcClientTransport()
  );
  return client;
}
