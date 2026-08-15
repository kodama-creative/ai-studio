import type { NetworkSettingsManager } from "@llm-space/runtime/network";

import type { RpcServer } from "../../shared/namespaced-rpc";
import {
  NETWORK_RPC,
  type NetworkRequests,
  type NetworkRpc,
} from "../../shared/network-rpc";
import type { RpcContribution } from "../di/rpc-contribution";
import type { RpcRegistry } from "../di/rpc-registry";

class NetworkRpcServer implements RpcServer<NetworkRpc> {
  readonly namespace = NETWORK_RPC;
  readonly streams = {};
  readonly requests: NetworkRequests;

  constructor(settings: NetworkSettingsManager) {
    this.requests = {
      get: () => Promise.resolve(settings.get()),
      set: (next) => Promise.resolve(settings.set(next)),
      detectSystemProxy: () => Promise.resolve(settings.detectSystemProxy()),
    };
  }
}

/** Owns network settings RPC for one native window. */
export class NetworkRpcContribution implements RpcContribution {
  constructor(private readonly _settings: NetworkSettingsManager) {}

  registerRpc(rpc: RpcRegistry): void {
    rpc.registerServer(new NetworkRpcServer(this._settings));
  }
}
