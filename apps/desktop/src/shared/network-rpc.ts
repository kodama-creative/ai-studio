import type {
  NetworkSettings,
  SystemProxyDetection,
} from "@llm-space/core";

import { defineRpcNamespace } from "./namespaced-rpc";
import type { RequestRpcShape } from "./rpc-shape";

export interface NetworkRequests {
  get(): Promise<NetworkSettings>;
  set(settings: NetworkSettings): Promise<NetworkSettings>;
  detectSystemProxy(): Promise<SystemProxyDetection>;
}

export type NetworkRpc = RequestRpcShape<NetworkRequests>;

export const NETWORK_RPC = defineRpcNamespace<NetworkRpc>("network", {
  requests: { get: true, set: true, detectSystemProxy: true },
  streams: {},
  events: {},
});
