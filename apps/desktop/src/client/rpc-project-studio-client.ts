import { createRpcClientProxy, type RpcClient } from "../shared/namespaced-rpc";
import {
  PROJECT_STUDIO_RPC,
  type ProjectStudioRpc,
  type ProjectStudioTransport,
} from "../shared/project-studio";

import { createElectrobunRpcClientTransport } from "./namespaced-rpc-client";

/** Create the Project namespace proxy from its shared compile-time interface. */
export function createRpcProjectStudioClient(): ProjectStudioTransport {
  const client: RpcClient<ProjectStudioRpc> = createRpcClientProxy(
    PROJECT_STUDIO_RPC,
    createElectrobunRpcClientTransport()
  );
  return client;
}
