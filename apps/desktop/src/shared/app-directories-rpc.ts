import { defineRpcNamespace } from "./namespaced-rpc";
import type { RequestRpcShape } from "./rpc-shape";

export interface AppDirectoriesRequests {
  ensure(relativePath: string): Promise<string>;
}

export type AppDirectoriesRpc = RequestRpcShape<AppDirectoriesRequests>;

export const APP_DIRECTORIES_RPC = defineRpcNamespace<AppDirectoriesRpc>(
  "appDirectories",
  { requests: { ensure: true }, streams: {}, events: {} }
);
