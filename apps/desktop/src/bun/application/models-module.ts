import type { ModelManager } from "@llm-space/runtime/models";
import { ContainerModule } from "inversify";

import { desktopToken, PROCESS_TOKENS } from "../di/tokens";

import { ModelsApplicationImpl, type ModelsApplication } from "./models-application";

export const MODELS_APPLICATION = desktopToken<ModelsApplication>(
  "models",
  "application"
);

/** Bind the process-scoped Models use cases and analytics orchestration. */
export function modelsModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind<ModelsApplication>(MODELS_APPLICATION)
      .toDynamicValue(
        (context) =>
          new ModelsApplicationImpl(
            context.get<ModelManager>(PROCESS_TOKENS.modelManager),
            context.get(PROCESS_TOKENS.analytics)
          )
      )
      .inSingletonScope();
  });
}
