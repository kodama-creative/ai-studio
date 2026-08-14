import { createRpcClientProxy } from "../shared/namespaced-rpc";
import {
  APP_DIRECTORIES_RPC,
  NATIVE_DIALOGS_RPC,
  NATIVE_FILES_RPC,
  WINDOW_RPC,
} from "../shared/native-rpc";

import { createElectrobunRpcClientTransport } from "./namespaced-rpc-client";

const transport = createElectrobunRpcClientTransport();
export const appDirectoriesClient = createRpcClientProxy(
  APP_DIRECTORIES_RPC,
  transport
);
export const nativeDialogsClient = createRpcClientProxy(
  NATIVE_DIALOGS_RPC,
  transport
);
export const nativeFilesClient = createRpcClientProxy(
  NATIVE_FILES_RPC,
  transport
);
export const windowClient = createRpcClientProxy(WINDOW_RPC, transport);

export const revealNativeFile = (path: string) =>
  nativeFilesClient.reveal(path);
export const pickNativeDirectory = () => nativeDialogsClient.pickDirectory();
