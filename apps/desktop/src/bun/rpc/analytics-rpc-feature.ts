import { ContainerModule } from "inversify";

import {
  ANALYTICS_RPC,
  type AnalyticsRpc,
} from "../../shared/application-rpc";
import type { RpcServer } from "../../shared/namespaced-rpc";
import {
  ANALYTICS_APPLICATION,
  type AnalyticsApplication,
} from "../application/analytics-application";
import type { DesktopWindowScope } from "../di/process-container";
import {
  RpcContribution,
  type RpcContribution as RpcContributionApi,
} from "../di/rpc-contribution";
import type { RpcRegistry } from "../di/rpc-registry";

class AnalyticsRpcServer implements RpcServer<AnalyticsRpc> {
  readonly namespace = ANALYTICS_RPC;
  readonly streams = {};

  constructor(readonly requests: AnalyticsApplication) {}
}

class AnalyticsContribution implements RpcContributionApi {
  constructor(private readonly _application: AnalyticsApplication) {}

  registerRpc(rpc: RpcRegistry): void {
    rpc.registerServer(new AnalyticsRpcServer(this._application));
  }
}

/** Bind analytics RPC as one window contribution. */
export function analyticsRpcModule(
  scope: DesktopWindowScope
): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(AnalyticsContribution)
      .toDynamicValue(
        () => new AnalyticsContribution(scope.get(ANALYTICS_APPLICATION))
      )
      .inSingletonScope();
    bind<RpcContributionApi>(RpcContribution).toService(AnalyticsContribution);
  });
}
