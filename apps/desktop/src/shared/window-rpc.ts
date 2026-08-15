import type { DesktopWindowContext } from "./agent-project";
import { defineRpcNamespace } from "./namespaced-rpc";

export interface WindowRequests {
  getContext(): Promise<DesktopWindowContext>;
  getFullscreenState(): Promise<{ fullScreen: boolean }>;
}

export interface WindowEvents {
  fullScreenChanged: { fullScreen: boolean };
}

export interface WindowRpc {
  readonly requests: WindowRequests;
  readonly streams: Record<never, never>;
  readonly events: WindowEvents;
}

export const WINDOW_RPC = defineRpcNamespace<WindowRpc>("window", {
  requests: {
    getContext: true,
    getFullscreenState: true,
  },
  streams: {},
  events: { fullScreenChanged: true },
});
