import { ContainerModule } from "inversify";

import type { RpcServer } from "../../shared/namespaced-rpc";
import { UPDATES_RPC, type UpdatesRpc } from "../../shared/updates-rpc";
import {
  UPDATES_APPLICATION,
  type UpdatesApplication,
} from "../application/updates-application";
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

class UpdatesRpcServer implements RpcServer<UpdatesRpc> {
  readonly namespace = UPDATES_RPC;
  readonly streams = {};
  readonly eventSource;

  constructor(readonly requests: UpdatesApplication) {
    this.eventSource = requests.events;
  }
}

class UpdatesContribution
  implements CommandContributionApi, RpcContributionApi
{
  constructor(private readonly _application: UpdatesApplication) {}

  registerCommands(commands: CommandRegistry): void {
    commands.registerCommand("updates.check", {
      execute: () => void this._application.check(),
    });
    commands.registerCommand("updates.applyAndRestart", {
      execute: () => void this._application.applyAndRestart(),
    });
  }

  registerRpc(rpc: RpcRegistry): void {
    rpc.registerServer(new UpdatesRpcServer(this._application));
  }
}

/** Bind update commands and RPC as one shared contribution instance. */
export function updatesRpcModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(UpdatesContribution)
      .toDynamicValue(
        (context) =>
          new UpdatesContribution(context.get(UPDATES_APPLICATION))
      )
      .inSingletonScope();
    bind<CommandContributionApi>(CommandContribution).toService(
      UpdatesContribution
    );
    bind<RpcContributionApi>(RpcContribution).toService(UpdatesContribution);
  });
}
