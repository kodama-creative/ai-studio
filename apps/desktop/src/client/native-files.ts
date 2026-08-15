import { createRpcClient } from "../shared/namespaced-rpc";
import {
  APP_DIRECTORIES_RPC,
  NATIVE_DIALOGS_RPC,
  NATIVE_FILES_RPC,
  WINDOW_RPC,
} from "../shared/native-rpc";

import { createElectrobunRpcClientTransport } from "./namespaced-rpc-client";

const transport = createElectrobunRpcClientTransport();
export const appDirectoriesClient = createRpcClient(
  APP_DIRECTORIES_RPC,
  transport
);
export const nativeDialogsClient = createRpcClient(
  NATIVE_DIALOGS_RPC,
  transport
);
export const nativeFilesClient = createRpcClient(
  NATIVE_FILES_RPC,
  transport
);
export const windowClient = createRpcClient(WINDOW_RPC, transport);

export const revealNativeFile = (path: string) =>
  nativeFilesClient.reveal(path);
export const pickNativeDirectory = () => nativeDialogsClient.pickDirectory();
