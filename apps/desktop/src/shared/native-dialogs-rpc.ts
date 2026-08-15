import { defineRpcNamespace } from "./namespaced-rpc";
import type { RequestRpcShape } from "./rpc-shape";

export interface NativeDialogsRequests {
  pickFile(): Promise<string | null>;
  pickDirectory(): Promise<string | null>;
}

export type NativeDialogsRpc = RequestRpcShape<NativeDialogsRequests>;

export const NATIVE_DIALOGS_RPC = defineRpcNamespace<NativeDialogsRpc>(
  "nativeDialogs",
  {
    requests: { pickFile: true, pickDirectory: true },
    streams: {},
    events: {},
  }
);
