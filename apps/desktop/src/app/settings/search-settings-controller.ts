import { DEFAULT_SEARCH_SETTINGS, type SearchSettings } from "@llm-space/core";
import { inject, injectable } from "inversify";

import { SEARCH_SERVICE, type SearchRequests } from "@/shared/search-rpc";

import { RendererNotificationService } from "../notifications/renderer-notification-service";

import { SettingsFormController } from "./settings-form-controller";

/** Own Search settings reads, ordered writes, rollback, and errors. */
@injectable()
export class SearchSettingsController extends SettingsFormController<SearchSettings> {
  constructor(
    @inject(SEARCH_SERVICE) search: SearchRequests,
    @inject(RendererNotificationService)
    notifications: RendererNotificationService
  ) {
    super({
      initialSettings: DEFAULT_SEARCH_SETTINGS,
      initialContext: undefined,
      loadSettings: () => search.get(),
      saveSettings: (settings) => search.set(settings),
      notifySaveError: (error) =>
        notifications.error("Failed to update search settings", error),
    });
  }
}
