import { ContainerModule } from "inversify";

import { AuxiliaryGenerationApplication } from "./auxiliary-generation-application";

/** Bind process-scoped auxiliary model generation. */
export function auxiliaryGenerationModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(AuxiliaryGenerationApplication).toSelf().inSingletonScope();
  });
}
