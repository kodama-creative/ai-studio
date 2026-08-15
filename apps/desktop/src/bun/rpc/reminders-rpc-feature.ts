import { ContainerModule } from "inversify";

import type { RpcServer } from "../../shared/namespaced-rpc";
import {
  REMINDERS_RPC,
  type RemindersRpc,
} from "../../shared/reminders-rpc";
import {
  RpcContribution,
  type RpcContribution as RpcContributionApi,
} from "../di/rpc-contribution";
import type { RpcRegistry } from "../di/rpc-registry";
import { REMINDERS_STATE } from "../reminders/reminders-module";
import type { RemindersState } from "../reminders/state";

class RemindersRpcServer implements RpcServer<RemindersRpc> {
  readonly namespace = REMINDERS_RPC;
  readonly streams = {};

  constructor(readonly requests: RemindersState) {}
}

class RemindersContribution implements RpcContributionApi {
  constructor(private readonly _state: RemindersState) {}

  registerRpc(rpc: RpcRegistry): void {
    rpc.registerServer(new RemindersRpcServer(this._state));
  }
}

/** Bind reminder RPC as one window contribution. */
export function remindersRpcModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(RemindersContribution)
      .toDynamicValue(
        (context) => new RemindersContribution(context.get(REMINDERS_STATE))
      )
      .inSingletonScope();
    bind<RpcContributionApi>(RpcContribution).toService(RemindersContribution);
  });
}
