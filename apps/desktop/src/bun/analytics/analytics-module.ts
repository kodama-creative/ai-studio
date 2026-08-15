import { ContainerModule } from "inversify";

import type { AnalyticsEvent } from "../../shared/analytics";
import {
  ANALYTICS_RPC,
  type AnalyticsRequests,
  type AnalyticsRpc,
} from "../../shared/analytics-rpc";
import type { RpcServer } from "../../shared/namespaced-rpc";
import {
  RpcContribution,
  type RpcContribution as RpcContributionApi,
} from "../di/rpc-contribution";
import type { RpcRegistry } from "../di/rpc-registry";
import { desktopToken } from "../di/tokens";
import { bindWindowFeature, windowFeature } from "../di/window-feature";

import type { Analytics } from "./index";

export const ANALYTICS = desktopToken<Analytics>("analytics", "analytics");

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
          new AnalyticsContribution(context.get(ANALYTICS))
      )
      .inSingletonScope();
    bind<RpcContributionApi>(RpcContribution).toService(AnalyticsContribution);
  });
}

/** Register Analytics as one bundled window feature. */
export function analyticsModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bindWindowFeature(
      bind,
      windowFeature("analytics", (scope) => scope.load(analyticsRpcModule()))
    );
  });
}
