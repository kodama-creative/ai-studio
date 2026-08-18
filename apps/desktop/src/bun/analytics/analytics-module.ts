import { ContainerModule } from "inversify";

import { Analytics } from "./analytics";

/** Bind the process-owned analytics authority. */
export function analyticsModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(Analytics).toSelf().inSingletonScope();
  });
}
