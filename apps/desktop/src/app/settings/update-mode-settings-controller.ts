import { inject, injectable } from "inversify";

import { DEFAULT_UPDATE_MODE, type UpdateMode } from "@/shared/updates";
import { UPDATES_SERVICE, type UpdatesRequests } from "@/shared/updates-rpc";

import { RendererNotificationService } from "../notifications/renderer-notification-service";

import { SettingsFormController } from "./settings-form-controller";

/** Own update-mode reads, ordered writes, rollback, and user-visible errors. */
@injectable()
export class UpdateModeSettingsController extends SettingsFormController<UpdateMode> {
  constructor(
    @inject(UPDATES_SERVICE) updates: UpdatesRequests,
    @inject(RendererNotificationService)
    notifications: RendererNotificationService
  ) {
    super({
      initialSettings: DEFAULT_UPDATE_MODE,
      initialContext: undefined,
      loadSettings: () => updates.getMode(),
      saveSettings: async (mode) => {
        await updates.setMode(mode);
        return mode;
      },
      notifySaveError: (error) =>
        notifications.error("Failed to update software update setting", error),
    });
  }
}
