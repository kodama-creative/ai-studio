import { ContainerModule } from "inversify";

import type { RemindersRequests } from "../../shared/application-rpc";
import { desktopToken } from "../di/tokens";
import {
  dismissGithubStarReminder,
  getNextFeatureReminder,
  markFeatureReminderSeen,
  resolveGithubStarReminder,
} from "../reminders/state";

export const REMINDERS_APPLICATION =
  desktopToken<RemindersApplication>("reminders", "application");

/** One-time product reminders; persistence remains owned by its store. */
export class RemindersApplication implements RemindersRequests {
  shouldShowGithubStar() {
    return resolveGithubStarReminder();
  }

  dismissGithubStarForever() {
    return dismissGithubStarReminder();
  }

  nextFeature() {
    return getNextFeatureReminder();
  }

  markFeatureSeen(id: string) {
    return markFeatureReminderSeen(id);
  }
}

/** Bind process-scoped reminder use cases. */
export function remindersApplicationModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind<RemindersApplication>(REMINDERS_APPLICATION)
      .to(RemindersApplication)
      .inSingletonScope();
  });
}
