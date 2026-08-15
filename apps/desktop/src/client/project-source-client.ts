import { createRpcClient, type RpcClient } from "../shared/namespaced-rpc";
import {
  PROJECT_SOURCE_RPC,
  type ProjectSourceRpc,
  type ProjectSourceTransport,
} from "../shared/project-source-rpc";

import { createElectrobunRpcClientTransport } from "./namespaced-rpc-client";

/** Create the Project source namespace proxy for one Studio window. */
export function createProjectSourceClient(): ProjectSourceTransport {
  const client: RpcClient<ProjectSourceRpc> = createRpcClient(
    PROJECT_SOURCE_RPC,
    createElectrobunRpcClientTransport()
  );
  return client;
}
