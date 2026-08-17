import { inject, injectable } from "inversify";

import {
  DEFAULT_ANALYTICS_SETTINGS,
  type AnalyticsStatus,
} from "@/shared/analytics";
import {
  ANALYTICS_SERVICE,
  type AnalyticsRequests,
} from "@/shared/analytics-rpc";

import { RendererNotificationService } from "../notifications/renderer-notification-service";

import { SettingsFormController } from "./settings-form-controller";

/** Own Analytics settings reads, optimistic writes, rollback, and errors. */
@injectable()
export class AnalyticsSettingsController extends SettingsFormController<AnalyticsStatus> {
  constructor(
    @inject(ANALYTICS_SERVICE) analytics: AnalyticsRequests,
    @inject(RendererNotificationService)
    notifications: RendererNotificationService
  ) {
    super({
      initialSettings: { ...DEFAULT_ANALYTICS_SETTINGS, available: true },
      initialContext: undefined,
      loadSettings: () => analytics.getSettings(),
      saveSettings: (status) => analytics.setEnabled(status.enabled),
      notifySaveError: (error) =>
        notifications.error("Failed to update analytics setting", error),
    });
  }
}
