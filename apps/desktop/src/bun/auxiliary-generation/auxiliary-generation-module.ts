import type { ModelManager } from "@llm-space/runtime/models";
import { ContainerModule } from "inversify";

import { bindWindowFeature, windowFeature } from "../di/window-feature";
import { MODEL_MANAGER } from "../models/models-module";

import { AuxiliaryGenerationApplication } from "./auxiliary-generation-application";
import { auxiliaryGenerationRpcModule } from "./auxiliary-generation-rpc-feature";

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
    bindWindowFeature(
      bind,
      windowFeature("auxiliary-generation", (scope) =>
        scope.load(auxiliaryGenerationRpcModule())
      )
    );
  });
}
