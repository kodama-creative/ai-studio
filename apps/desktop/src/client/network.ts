import type { NetworkSettings, SystemProxyDetection } from "@llm-space/core";

import type { RuntimeId } from "@/shared/runtime";

import { networkClient } from "./runtime-rpc-clients";

export async function getNetworkSettings(
  runtimeId?: RuntimeId
): Promise<NetworkSettings> {
  return networkClient.get(runtimeId);
}

export async function setNetworkSettings(
  settings: NetworkSettings,
  runtimeId?: RuntimeId
): Promise<NetworkSettings> {
  return networkClient.set(runtimeId, settings);
}

export async function detectSystemProxy(
  runtimeId?: RuntimeId
): Promise<SystemProxyDetection> {
  return networkClient.detectSystemProxy(runtimeId);
}
