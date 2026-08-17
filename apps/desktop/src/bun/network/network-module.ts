import type { NetworkSettingsManager } from "@llm-space/runtime/network";
import { ContainerModule } from "inversify";

import type { RpcServer } from "../../shared/namespaced-rpc";
import {
  NETWORK_RPC,
  type NetworkRequests,
  type NetworkRpc,
} from "../../shared/network-rpc";
import {
  RpcContribution,
  type RpcContribution as RpcContributionApi,
} from "../di/rpc-contribution";
import type { RpcRegistry } from "../di/rpc-registry";
import { desktopToken } from "../di/tokens";

export const NETWORK_SETTINGS = desktopToken<NetworkSettingsManager>(
  "network",
  "settings"
);

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
class NetworkRpcContribution implements RpcContributionApi {
  constructor(private readonly _settings: NetworkSettingsManager) {}

  registerRpc(rpc: RpcRegistry): void {
    rpc.registerServer(new NetworkRpcServer(this._settings));
  }
}

/** Bind network settings RPC as one window contribution. */
export function networkRpcModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(NetworkRpcContribution)
      .toDynamicValue(
        (context) =>
          new NetworkRpcContribution(
            context.get<NetworkSettingsManager>(NETWORK_SETTINGS)
          )
      )
      .inSingletonScope();
    bind<RpcContributionApi>(RpcContribution).toService(NetworkRpcContribution);
  });
}
