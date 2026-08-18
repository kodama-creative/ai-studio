import { ModelManager } from "@llm-space/runtime/models";
import { ContainerModule } from "inversify";

import { ArkImageGenerationService } from "./ark-image-generation-service";
import { ModelsService } from "./models-service";

/** Bind the process-scoped Models use cases and analytics orchestration. */
export function modelsModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(ModelManager).toSelf().inSingletonScope();
    bind(ArkImageGenerationService).toSelf().inSingletonScope();
    bind(ModelsService).toSelf().inSingletonScope();
  });
}
