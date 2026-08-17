import type {
  NetworkSettings,
  SystemProxyDetection,
} from "@llm-space/core";
import { DEFAULT_NETWORK_SETTINGS } from "@llm-space/core";
import { inject, injectable } from "inversify";

import { NETWORK_SERVICE, type NetworkRequests } from "@/shared/network-rpc";

import { RendererNotificationService } from "../notifications/renderer-notification-service";

import { SettingsFormController } from "./settings-form-controller";

/** Own Network settings plus best-effort system-proxy discovery. */
@injectable()
export class NetworkSettingsController extends SettingsFormController<
  NetworkSettings,
  SystemProxyDetection | null
> {
  constructor(
    @inject(NETWORK_SERVICE) network: NetworkRequests,
    @inject(RendererNotificationService)
    notifications: RendererNotificationService
  ) {
    super({
      initialSettings: DEFAULT_NETWORK_SETTINGS,
      initialContext: null,
      loadSettings: () => network.get(),
      saveSettings: (settings) => network.set(settings),
      loadContext: () => network.detectSystemProxy(),
      notifySaveError: (error) =>
        notifications.error("Failed to update network settings", error),
    });
  }
}
