import { createRpcClient, type RpcClient } from "../shared/namespaced-rpc";
import {
  STUDIO_RPC,
  type StudioRpc,
  type StudioTransport,
} from "../shared/studio-rpc";

import { createElectrobunRpcClientTransport } from "./namespaced-rpc-client";

/** Create the Studio Thread metadata namespace proxy. */
export function createStudioClient(): StudioTransport {
  const client: RpcClient<StudioRpc> = createRpcClient(
    STUDIO_RPC,
    createElectrobunRpcClientTransport()
  );
  return client;
}
