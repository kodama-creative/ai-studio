import { ContainerModule } from "inversify";

import type { RpcServer } from "../../shared/namespaced-rpc";
import {
  UPDATES_RPC,
  type UpdatesRequests,
  type UpdatesRpc,
} from "../../shared/updates-rpc";
import {
  CommandContribution,
  type CommandContribution as CommandContributionApi,
} from "../di/command-contribution";
import type { CommandRegistry } from "../di/command-registry";
import {
  RpcContribution,
  type RpcContribution as RpcContributionApi,
} from "../di/rpc-contribution";
import type { RpcRegistry } from "../di/rpc-registry";
import { desktopToken } from "../di/tokens";
import { bindWindowFeature, windowFeature } from "../di/window-feature";

import type { UpdaterService } from "./index";

export const UPDATER = desktopToken<UpdaterService>("updates", "updater");

class UpdatesRpcServer implements RpcServer<UpdatesRpc> {
  readonly namespace = UPDATES_RPC;
  readonly streams = {};
  readonly eventSource;
  readonly requests: UpdatesRequests;

  constructor(updater: UpdaterService) {
    this.requests = {
      getMode: () => updater.getUpdateModeSetting(),
      setMode: (mode) => updater.setUpdateModeSetting(mode),
      takeInstalledVersion: () =>
        Promise.resolve(updater.getInstalledVersion()),
    };
    this.eventSource = updater.events;
  }
}

class UpdatesContribution
  implements CommandContributionApi, RpcContributionApi
{
  constructor(private readonly _updater: UpdaterService) {}

  registerCommands(commands: CommandRegistry): void {
    commands.registerCommand("updates.check", {
      execute: () => this._updater.checkForUpdates(true),
    });
    commands.registerCommand("updates.applyAndRestart", {
      execute: () => this._updater.applyUpdateAndRestart(),
    });
  }

  registerRpc(rpc: RpcRegistry): void {
    rpc.registerServer(new UpdatesRpcServer(this._updater));
  }
}

/** Bind update commands and RPC as one shared contribution instance. */
export function updatesRpcModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(UpdatesContribution)
      .toDynamicValue(
        (context) =>
          new UpdatesContribution(
            context.get<UpdaterService>(UPDATER)
          )
      )
      .inSingletonScope();
    bind<CommandContributionApi>(CommandContribution).toService(
      UpdatesContribution
    );
    bind<RpcContributionApi>(RpcContribution).toService(UpdatesContribution);
  });
}

/** Register update commands and RPC as one bundled window feature. */
export function updatesModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bindWindowFeature(
      bind,
      windowFeature("updates", (scope) => scope.load(updatesRpcModule()))
    );
  });
}
