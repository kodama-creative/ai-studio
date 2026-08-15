import type { NetworkSettings, SystemProxyDetection } from "@llm-space/core";

import { createRpcClient } from "@/shared/namespaced-rpc";
import { NETWORK_RPC } from "@/shared/network-rpc";

import { createElectrobunRpcClientTransport } from "./namespaced-rpc-client";

const networkClient = createRpcClient(
  NETWORK_RPC,
  createElectrobunRpcClientTransport()
);

export async function getNetworkSettings(): Promise<NetworkSettings> {
  return networkClient.get();
}

export async function setNetworkSettings(
  settings: NetworkSettings
): Promise<NetworkSettings> {
  return networkClient.set(settings);
}

export async function detectSystemProxy(): Promise<SystemProxyDetection> {
  return networkClient.detectSystemProxy();
}
