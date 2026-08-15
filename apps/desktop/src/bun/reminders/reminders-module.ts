import { join } from "node:path";

import { ContainerModule } from "inversify";

import { bindWindowFeature, windowFeature } from "../di/window-feature";
import { APP_HOME_PATH } from "../native/app-directories-module";

import { remindersRpcModule } from "./reminders-rpc-feature";
import { RemindersState } from "./state";

/** Bind the process-owned, serialized reminder state. */
export function remindersModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(RemindersState)
      .toDynamicValue(
        (context) =>
          new RemindersState(
            join(
              context.get<string>(APP_HOME_PATH),
              "settings",
              "reminders.json"
            )
          )
      )
      .inSingletonScope();
    bindWindowFeature(
      bind,
      windowFeature("reminders", (scope) =>
        scope.load(remindersRpcModule())
      )
    );
  });
}
