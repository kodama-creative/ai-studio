import type { AnalyticsStatus } from "@/shared/analytics";

import { analyticsClient } from "./application-rpc-clients";

export async function getAnalyticsSettings(): Promise<AnalyticsStatus> {
  return analyticsClient.getSettings();
}

export async function setAnalyticsSettings(
  enabled: boolean
): Promise<AnalyticsStatus> {
  return analyticsClient.setEnabled(enabled);
}
