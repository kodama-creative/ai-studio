import { createRpcClient } from "@/shared/namespaced-rpc";
import { NETWORK_RPC, type NetworkRequests } from "@/shared/network-rpc";

import { createElectrobunRpcClientTransport } from "./namespaced-rpc-client";

export type NetworkClient = NetworkRequests;

/** Create one typed Network namespace proxy for its owning settings module. */
export function createNetworkClient(): NetworkClient {
  return createRpcClient(NETWORK_RPC, createElectrobunRpcClientTransport());
}
