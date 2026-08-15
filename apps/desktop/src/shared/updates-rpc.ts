import { defineRpcNamespace } from "./namespaced-rpc";
import type { UpdateMode, UpdateStatusChangedPayload } from "./updates";

export interface UpdatesRequests {
  getMode(): Promise<UpdateMode>;
  setMode(mode: UpdateMode): Promise<void>;
  takeInstalledVersion(): Promise<string | null>;
}

export interface UpdatesEvents {
  statusChanged: UpdateStatusChangedPayload;
}

export interface UpdatesRpc {
  readonly requests: UpdatesRequests;
  readonly streams: Record<never, never>;
  readonly events: UpdatesEvents;
}

export const UPDATES_RPC = defineRpcNamespace<UpdatesRpc>("updates", {
  requests: { getMode: true, setMode: true, takeInstalledVersion: true },
  streams: {},
  events: { statusChanged: true },
});
