import { ContainerModule } from "inversify";

import { UpdaterService } from "./updater-service";
import { UpdatesState } from "./updates-state";

/** Bind process-owned update scheduling and persisted state. */
export function updatesModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(UpdatesState).toSelf().inSingletonScope();
    bind(UpdaterService).toSelf().inSingletonScope();
  });
}
