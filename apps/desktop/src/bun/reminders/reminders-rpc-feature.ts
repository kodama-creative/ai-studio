import { ContainerModule, inject, injectable } from "inversify";

import {
  REMINDERS_RPC,
  type RemindersRpc,
} from "../../shared/reminders-rpc";
import {
  RpcContribution,
  type RpcContribution as RpcContributionApi,
} from "../di/rpc-contribution";
import type { RpcRegistry } from "../di/rpc-registry";
import { RemindersState } from "../reminders/state";

@injectable()
class RemindersContribution implements RpcContributionApi {
  constructor(@inject(RemindersState) private readonly _state: RemindersState) {}

  registerRpc(rpc: RpcRegistry): void {
    rpc.registerServer({
      namespace: REMINDERS_RPC,
      requests: this._state,
      streams: {},
    } satisfies import("../../shared/namespaced-rpc").RpcServer<RemindersRpc>);
  }
}

/** Bind the reminder feature's RPC adapter as one window contribution. */
export function remindersRpcModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(RemindersContribution).toSelf().inSingletonScope();
    bind<RpcContributionApi>(RpcContribution).toService(RemindersContribution);
  });
}
