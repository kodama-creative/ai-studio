import type { NetworkSettingsManager } from "@llm-space/runtime/network";
import { ContainerModule, inject, injectable } from "inversify";

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

export const NETWORK_SETTINGS = Symbol("NetworkSettingsManager");

/** Owns network settings RPC for one native window. */
@injectable()
class NetworkRpcContribution implements RpcContributionApi {
  constructor(
    @inject(NETWORK_SETTINGS)
    private readonly _settings: NetworkSettingsManager
  ) {}

  registerRpc(rpc: RpcRegistry): void {
    const requests: NetworkRequests = {
      get: () => Promise.resolve(this._settings.get()),
      set: (next) => Promise.resolve(this._settings.set(next)),
      detectSystemProxy: () =>
        Promise.resolve(this._settings.detectSystemProxy()),
    };
    rpc.registerServer({
      namespace: NETWORK_RPC,
      requests,
      streams: {},
    } satisfies import("../../shared/namespaced-rpc").RpcServer<NetworkRpc>);
  }
}

/** Bind network settings RPC as one window contribution. */
export function networkRpcModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(NetworkRpcContribution).toSelf().inSingletonScope();
    bind<RpcContributionApi>(RpcContribution).toService(NetworkRpcContribution);
  });
}
