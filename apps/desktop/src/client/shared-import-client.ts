import { createRpcClientProxy } from "../shared/namespaced-rpc";
import { SHARED_IMPORT_RPC } from "../shared/shared-import-rpc";

import { createElectrobunRpcClientTransport } from "./namespaced-rpc-client";

export const sharedImportClient = createRpcClientProxy(
  SHARED_IMPORT_RPC,
  createElectrobunRpcClientTransport()
);
