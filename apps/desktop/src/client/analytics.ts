import type { AnalyticsStatus } from "@/shared/analytics";
import { ANALYTICS_RPC } from "@/shared/analytics-rpc";
import { createRpcClient } from "@/shared/namespaced-rpc";

import { createElectrobunRpcClientTransport } from "./namespaced-rpc-client";

/** Renderer client owned by the Analytics RPC feature. */
export const analyticsClient = createRpcClient(
  ANALYTICS_RPC,
  createElectrobunRpcClientTransport()
);

export async function getAnalyticsSettings(): Promise<AnalyticsStatus> {
  return analyticsClient.getSettings();
}

export async function setAnalyticsSettings(
  enabled: boolean
): Promise<AnalyticsStatus> {
  return analyticsClient.setEnabled(enabled);
}
