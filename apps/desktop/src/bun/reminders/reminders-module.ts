import { ContainerModule } from "inversify";

import { RemindersState } from "./state";

/** Bind the process-owned, serialized reminder state. */
export function remindersModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(RemindersState)
      .toSelf()
      .inSingletonScope()
      .onDeactivation((state) => state.dispose());
  });
}
