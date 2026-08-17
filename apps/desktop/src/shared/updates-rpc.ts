import { defineRpcNamespace } from "./namespaced-rpc";
import type { UpdateMode, UpdateStatusChangedPayload } from "./updates";

export const UPDATES_SERVICE = Symbol("UpdatesService");

export interface UpdatesRequests {
  getMode(): Promise<UpdateMode>;
  setMode(mode: UpdateMode): Promise<void>;
  takeInstalledVersion(): Promise<string | null>;
  check(): Promise<void>;
  applyAndRestart(): Promise<void>;
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
  requests: {
    getMode: true,
    setMode: true,
    takeInstalledVersion: true,
    check: true,
    applyAndRestart: true,
  },
  streams: {},
  events: { statusChanged: true },
});
