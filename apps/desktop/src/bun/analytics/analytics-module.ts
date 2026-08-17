import { ContainerModule, inject, injectable } from "inversify";

import type { AnalyticsEvent } from "../../shared/analytics";
import {
  ANALYTICS_RPC,
  type AnalyticsRequests,
  type AnalyticsRpc,
} from "../../shared/analytics-rpc";
import {
  RpcContribution,
  type RpcContribution as RpcContributionApi,
} from "../di/rpc-contribution";
import type { RpcRegistry } from "../di/rpc-registry";

import type { Analytics } from "./index";

export const ANALYTICS = Symbol("Analytics");

@injectable()
class AnalyticsContribution implements RpcContributionApi {
  constructor(@inject(ANALYTICS) private readonly _analytics: Analytics) {}

  registerRpc(rpc: RpcRegistry): void {
    const requests: AnalyticsRequests = {
      getSettings: () => Promise.resolve(this._analytics.getSettings()),
      setEnabled: (enabled) =>
        Promise.resolve(this._analytics.setEnabled(enabled)),
      capture: (input: AnalyticsEvent) => {
        this._analytics.capture(input.event, input.properties);
        return Promise.resolve();
      },
    };
    rpc.registerServer({
      namespace: ANALYTICS_RPC,
      requests,
      streams: {},
    } satisfies import("../../shared/namespaced-rpc").RpcServer<AnalyticsRpc>);
  }
}

/** Bind analytics RPC as one window contribution. */
export function analyticsRpcModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(AnalyticsContribution).toSelf().inSingletonScope();
    bind<RpcContributionApi>(RpcContribution).toService(AnalyticsContribution);
  });
}
