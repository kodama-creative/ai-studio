import { ANALYTICS_RPC, type AnalyticsRequests } from "@/shared/analytics-rpc";
import { createRpcClient } from "@/shared/namespaced-rpc";

import { createElectrobunRpcClientTransport } from "./namespaced-rpc-client";

export type AnalyticsClient = AnalyticsRequests;

/** Create one typed Analytics namespace proxy for its owning renderer module. */
export function createAnalyticsClient(): AnalyticsClient {
  return createRpcClient(ANALYTICS_RPC, createElectrobunRpcClientTransport());
}
