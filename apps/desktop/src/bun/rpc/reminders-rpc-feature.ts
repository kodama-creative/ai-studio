import { ContainerModule } from "inversify";

import type { RpcServer } from "../../shared/namespaced-rpc";
import {
  REMINDERS_RPC,
  type RemindersRequests,
  type RemindersRpc,
} from "../../shared/reminders-rpc";
import {
  RpcContribution,
  type RpcContribution as RpcContributionApi,
} from "../di/rpc-contribution";
import type { RpcRegistry } from "../di/rpc-registry";
import {
  dismissGithubStarReminder,
  getNextFeatureReminder,
  markFeatureReminderSeen,
  resolveGithubStarReminder,
} from "../reminders/state";

class RemindersRpcServer implements RpcServer<RemindersRpc> {
  readonly namespace = REMINDERS_RPC;
  readonly streams = {};
  readonly requests: RemindersRequests = {
    shouldShowGithubStar: () => resolveGithubStarReminder(),
    dismissGithubStarForever: () => dismissGithubStarReminder(),
    nextFeature: () => getNextFeatureReminder(),
    markFeatureSeen: (id) => markFeatureReminderSeen(id),
  };
}

class RemindersContribution implements RpcContributionApi {
  registerRpc(rpc: RpcRegistry): void {
    rpc.registerServer(new RemindersRpcServer());
  }
}

/** Bind reminder RPC as one window contribution. */
export function remindersRpcModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(RemindersContribution).toSelf().inSingletonScope();
    bind<RpcContributionApi>(RpcContribution).toService(RemindersContribution);
  });
}
