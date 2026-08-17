import type { AnalyticsEvent, AnalyticsStatus } from "./analytics";
import { defineRpcNamespace } from "./namespaced-rpc";

export const ANALYTICS_SERVICE = Symbol("AnalyticsService");

export interface AnalyticsRequests {
  getSettings(): Promise<AnalyticsStatus>;
  setEnabled(enabled: boolean): Promise<AnalyticsStatus>;
  capture(event: AnalyticsEvent): Promise<void>;
}

export interface AnalyticsRpc {
  readonly requests: AnalyticsRequests;
  readonly streams: Record<never, never>;
  readonly events: Record<never, never>;
}

export const ANALYTICS_RPC = defineRpcNamespace<AnalyticsRpc>("analytics", {
  requests: { getSettings: true, setEnabled: true, capture: true },
  streams: {},
  events: {},
});
