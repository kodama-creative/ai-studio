import { ContainerModule } from "inversify";

import {
  REMINDERS_RPC,
  type RemindersRpc,
} from "../../shared/application-rpc";
import type { RpcServer } from "../../shared/namespaced-rpc";
import {
  REMINDERS_APPLICATION,
  type RemindersApplication,
} from "../application/reminders-application";
import {
  RpcContribution,
  type RpcContribution as RpcContributionApi,
} from "../di/rpc-contribution";
import type { RpcRegistry } from "../di/rpc-registry";

class RemindersRpcServer implements RpcServer<RemindersRpc> {
  readonly namespace = REMINDERS_RPC;
  readonly streams = {};

  constructor(readonly requests: RemindersApplication) {}
}

class RemindersContribution implements RpcContributionApi {
  constructor(private readonly _application: RemindersApplication) {}

  registerRpc(rpc: RpcRegistry): void {
    rpc.registerServer(new RemindersRpcServer(this._application));
  }
}

/** Bind reminder RPC as one window contribution. */
export function remindersRpcModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(RemindersContribution)
      .toDynamicValue(
        (context) =>
          new RemindersContribution(context.get(REMINDERS_APPLICATION))
      )
      .inSingletonScope();
    bind<RpcContributionApi>(RpcContribution).toService(RemindersContribution);
  });
}
