import { ContainerModule } from "inversify";

import type { AnalyticsEvent } from "../../shared/analytics";
import {
  ANALYTICS_RPC,
  type AnalyticsRequests,
  type AnalyticsRpc,
} from "../../shared/analytics-rpc";
import type { RpcServer } from "../../shared/namespaced-rpc";
import type { Analytics } from "../analytics";
import {
  RpcContribution,
  type RpcContribution as RpcContributionApi,
} from "../di/rpc-contribution";
import type { RpcRegistry } from "../di/rpc-registry";
import { PROCESS_TOKENS } from "../di/tokens";

class AnalyticsRpcServer implements RpcServer<AnalyticsRpc> {
  readonly namespace = ANALYTICS_RPC;
  readonly streams = {};
  readonly requests: AnalyticsRequests;

  constructor(analytics: Analytics) {
    this.requests = {
      getSettings: () => Promise.resolve(analytics.getSettings()),
      setEnabled: (enabled) => Promise.resolve(analytics.setEnabled(enabled)),
      capture: (input: AnalyticsEvent) => {
        analytics.capture(input.event, input.properties);
        return Promise.resolve();
      },
    };
  }
}

class AnalyticsContribution implements RpcContributionApi {
  constructor(private readonly _analytics: Analytics) {}

  registerRpc(rpc: RpcRegistry): void {
    rpc.registerServer(new AnalyticsRpcServer(this._analytics));
  }
}

/** Bind analytics RPC as one window contribution. */
export function analyticsRpcModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(AnalyticsContribution)
      .toDynamicValue(
        (context) =>
          new AnalyticsContribution(context.get(PROCESS_TOKENS.analytics))
      )
      .inSingletonScope();
    bind<RpcContributionApi>(RpcContribution).toService(AnalyticsContribution);
  });
}
