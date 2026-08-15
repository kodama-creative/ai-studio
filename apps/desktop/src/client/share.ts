import { createRpcClient, type RpcClient } from "@/shared/namespaced-rpc";
import {
  THREAD_SHARING_RPC,
  type ThreadSharingRequests,
  type ThreadSharingRpc,
} from "@/shared/thread-sharing-rpc";

import { createElectrobunRpcClientTransport } from "./namespaced-rpc-client";

/** Create a renderer adapter for the Thread Sharing RPC feature. */
export function createThreadSharingClient(): ThreadSharingRequests {
  const client: RpcClient<ThreadSharingRpc> = createRpcClient(
    THREAD_SHARING_RPC,
    createElectrobunRpcClientTransport()
  );
  return client;
}
