import { join } from "node:path";

import { ContainerModule } from "inversify";

import { desktopToken, PROCESS_TOKENS } from "../di/tokens";

import { RemindersState } from "./state";

export const REMINDERS_STATE =
  desktopToken<RemindersState>("reminders", "state");

/** Bind the process-owned, serialized reminder state. */
export function remindersModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind<RemindersState>(REMINDERS_STATE)
      .toDynamicValue(
        (context) =>
          new RemindersState(
            join(
              context.get<string>(PROCESS_TOKENS.homePath),
              "settings",
              "reminders.json"
            )
          )
      )
      .inSingletonScope();
  });
}
