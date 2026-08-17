import type { ModelManager } from "@llm-space/runtime/models";
import { ContainerModule } from "inversify";

import { MODEL_MANAGER } from "../models/models-module";

import { AuxiliaryGenerationApplication } from "./auxiliary-generation-application";

/** Bind process-scoped auxiliary model generation. */
export function auxiliaryGenerationModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(AuxiliaryGenerationApplication)
      .toDynamicValue((context) => {
        const modelManager = context.get<ModelManager>(
          MODEL_MANAGER
        );
        return new AuxiliaryGenerationApplication({
          models: () => modelManager.getAvailableModels(),
          resolveConnection: ({ providerId, profileId }) =>
            modelManager.resolveConnection({ providerId, profileId }),
        });
      })
      .inSingletonScope();
  });
}
