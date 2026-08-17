import type { RendererNotificationService } from "../../notifications/renderer-notification-service";

import type { ModelsSettingsFailure } from "./models-settings-controller";

/** Translate a Models workflow failure into its user-facing notification. */
export function reportModelMutationFailure(
  notifications: Pick<RendererNotificationService, "error">,
  failure: ModelsSettingsFailure,
  error: unknown
): void {
  notifications.error(_failureTitle(failure), error);
}

/** Keep Models-specific wording inside the Models feature slice. */
function _failureTitle(failure: ModelsSettingsFailure): string {
  switch (failure.operation) {
    case "add-provider":
      return `Failed to add ${failure.providerName}`;
    case "remove-provider":
      return "Failed to remove provider";
    case "save-provider-metadata":
      return "Failed to update provider";
    case "mutate-provider-profiles":
      return "Failed to update provider profiles";
    case "save-provider-profile":
      return "Failed to update provider profile";
  }
}
