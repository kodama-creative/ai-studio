import { defineRpcNamespace } from "./namespaced-rpc";
import type { RequestRpcShape } from "./rpc-shape";

export interface NativeFilesRequests {
  directoryExists(path: string): Promise<boolean>;
  reveal(pathOrLocator: string): Promise<void>;
}

export type NativeFilesRpc = RequestRpcShape<NativeFilesRequests>;

export const NATIVE_FILES_RPC = defineRpcNamespace<NativeFilesRpc>(
  "nativeFiles",
  {
    requests: { directoryExists: true, reveal: true },
    streams: {},
    events: {},
  }
);
