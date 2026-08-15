import { createRpcClient, type RpcClient } from "@/shared/namespaced-rpc";
import {
  REMINDERS_RPC,
  type RemindersRequests,
  type RemindersRpc,
} from "@/shared/reminders-rpc";

import { createElectrobunRpcClientTransport } from "./namespaced-rpc-client";

/** Create a renderer adapter for the Reminders RPC feature. */
export function createRemindersClient(): RemindersRequests {
  const client: RpcClient<RemindersRpc> = createRpcClient(
    REMINDERS_RPC,
    createElectrobunRpcClientTransport()
  );
  return client;
}
