import { createRpcClient } from "@/shared/namespaced-rpc";
import { NATIVE_DIALOGS_RPC } from "@/shared/native-dialogs-rpc";

import { createElectrobunRpcClientTransport } from "./namespaced-rpc-client";

/** Create one typed Native Dialogs proxy for its owning renderer module. */
export function createNativeDialogsClient() {
  return createRpcClient(
    NATIVE_DIALOGS_RPC,
    createElectrobunRpcClientTransport()
  );
}
