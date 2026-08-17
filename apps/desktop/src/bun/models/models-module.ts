import { ContainerModule } from "inversify";

import { ModelsService } from "./models-service";

/** Bind the process-scoped Models use cases and analytics orchestration. */
export function modelsModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(ModelsService).toSelf().inSingletonScope();
  });
}
