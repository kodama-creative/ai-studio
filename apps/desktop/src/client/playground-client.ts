import { createRpcClientProxy, type RpcClient } from "../shared/namespaced-rpc";
import {
  PLAYGROUND_RPC,
  type PlaygroundClient,
  type PlaygroundRpc,
} from "../shared/playground-rpc";

import { createElectrobunRpcClientTransport } from "./namespaced-rpc-client";

export type { PlaygroundClient } from "../shared/playground-rpc";

/** Create the Playground namespace proxy from its shared interface. */
export function createPlaygroundClient(): PlaygroundClient {
  const client: RpcClient<PlaygroundRpc> = createRpcClientProxy(
    PLAYGROUND_RPC,
    createElectrobunRpcClientTransport()
  );
  return client;
}
