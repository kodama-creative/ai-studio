import { ContainerModule, inject, injectable } from "inversify";

import {
  UPDATES_RPC,
  type UpdatesRequests,
  type UpdatesRpc,
} from "../../shared/updates-rpc";
import {
  RpcContribution,
  type RpcContribution as RpcContributionApi,
} from "../di/rpc-contribution";
import type { RpcRegistry } from "../di/rpc-registry";

import { UpdaterService } from "./updater-service";

@injectable()
class UpdatesContribution implements RpcContributionApi {
  constructor(
    @inject(UpdaterService) private readonly _updater: UpdaterService
  ) {}

  registerRpc(rpc: RpcRegistry): void {
    const requests: UpdatesRequests = {
      getMode: () => this._updater.getUpdateModeSetting(),
      setMode: (mode) => this._updater.setUpdateModeSetting(mode),
      takeInstalledVersion: () =>
        Promise.resolve(this._updater.getInstalledVersion()),
      check: () => this._updater.checkForUpdates(true),
      applyAndRestart: () => this._updater.applyUpdateAndRestart(),
    };
    rpc.registerServer({
      namespace: UPDATES_RPC,
      requests,
      streams: {},
      eventSource: this._updater.events,
    } satisfies import("../../shared/namespaced-rpc").RpcServer<UpdatesRpc>);
  }
}

/** Bind update commands and RPC as one shared contribution instance. */
export function updatesRpcModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(UpdatesContribution).toSelf().inSingletonScope();
    bind<RpcContributionApi>(RpcContribution).toService(UpdatesContribution);
  });
}
