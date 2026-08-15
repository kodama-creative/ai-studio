import type { ModelManager } from "@llm-space/runtime/models";
import { ContainerModule } from "inversify";

import { desktopToken, PROCESS_TOKENS } from "../di/tokens";

import { AuxiliaryGenerationApplication } from "./auxiliary-generation-application";

export const AUXILIARY_GENERATION_APPLICATION =
  desktopToken<AuxiliaryGenerationApplication>(
    "auxiliary-generation",
    "application"
  );

/** Bind process-scoped auxiliary model generation. */
export function auxiliaryGenerationModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind<AuxiliaryGenerationApplication>(AUXILIARY_GENERATION_APPLICATION)
      .toDynamicValue((context) => {
        const modelManager = context.get<ModelManager>(
          PROCESS_TOKENS.modelManager
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
