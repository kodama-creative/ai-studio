import { ContainerModule, type ResolutionContext } from "inversify";

import type { AnalyticsEvent } from "../../shared/analytics";
import type { AnalyticsRequests } from "../../shared/analytics-rpc";
import type { Analytics } from "../analytics";
import { desktopToken, PROCESS_TOKENS } from "../di/tokens";

export const ANALYTICS_APPLICATION =
  desktopToken<AnalyticsApplication>("analytics", "application");

/** Analytics preferences and explicitly allowed anonymous event capture. */
export class AnalyticsApplication implements AnalyticsRequests {
  constructor(private readonly _analytics: Analytics) {}

  getSettings() {
    return Promise.resolve(this._analytics.getSettings());
  }

  setEnabled(enabled: boolean) {
    return Promise.resolve(this._analytics.setEnabled(enabled));
  }

  capture(input: AnalyticsEvent) {
    this._analytics.capture(input.event, input.properties);
    return Promise.resolve();
  }
}

/** Bind process-scoped analytics use cases. */
export function analyticsApplicationModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind<AnalyticsApplication>(ANALYTICS_APPLICATION)
      .toDynamicValue(
        (context: ResolutionContext) =>
          new AnalyticsApplication(context.get(PROCESS_TOKENS.analytics))
      )
      .inSingletonScope();
  });
}
