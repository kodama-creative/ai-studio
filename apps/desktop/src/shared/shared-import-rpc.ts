import { defineRpcNamespace } from "./namespaced-rpc";
import type { SharedImportStatusPayload } from "./shared-import";

export interface SharedImportRequests {
  cancel(): Promise<void>;
}
export interface SharedImportEvents {
  statusChanged: SharedImportStatusPayload;
}
export interface SharedImportRpc {
  readonly requests: SharedImportRequests;
  readonly streams: Record<never, never>;
  readonly events: SharedImportEvents;
}
export const SHARED_IMPORT_RPC = defineRpcNamespace<SharedImportRpc>(
  "sharedImport",
  { streams: [], events: ["statusChanged"] }
);
