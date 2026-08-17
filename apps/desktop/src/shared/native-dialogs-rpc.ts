import type { ImportFilePayload } from "./commands";
import { defineRpcNamespace } from "./namespaced-rpc";
import type { RequestRpcShape } from "./rpc-shape";

export const NATIVE_DIALOGS_SERVICE = Symbol("NativeDialogsService");

export interface NativeDialogsRequests {
  pickFile(): Promise<string | null>;
  pickDirectory(): Promise<string | null>;
  pickImportFiles(): Promise<readonly ImportFilePayload[]>;
  readClipboardImport(): Promise<readonly ImportFilePayload[]>;
}

export type NativeDialogsRpc = RequestRpcShape<NativeDialogsRequests>;

export const NATIVE_DIALOGS_RPC = defineRpcNamespace<NativeDialogsRpc>(
  "nativeDialogs",
  {
    requests: {
      pickFile: true,
      pickDirectory: true,
      pickImportFiles: true,
      readClipboardImport: true,
    },
    streams: {},
    events: {},
  }
);
