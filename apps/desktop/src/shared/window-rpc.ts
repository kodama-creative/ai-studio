import type { DesktopWindowContext } from "./agent-project";
import { defineRpcNamespace } from "./namespaced-rpc";

export const WINDOW_SERVICE = Symbol("WindowService");

export interface WindowRequests {
  getContext(): Promise<DesktopWindowContext>;
  getFullscreenState(): Promise<{ fullScreen: boolean }>;
  toggleMaximized(): Promise<void>;
  zoomIn(): Promise<void>;
  zoomOut(): Promise<void>;
  resetZoom(): Promise<void>;
  reload(): Promise<void>;
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
    toggleMaximized: true,
    zoomIn: true,
    zoomOut: true,
    resetZoom: true,
    reload: true,
  },
  streams: {},
  events: { fullScreenChanged: true },
});
