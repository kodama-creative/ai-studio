import type { ModelManager } from "@llm-space/runtime/models";
import { ContainerModule } from "inversify";

import { ANALYTICS } from "../analytics/analytics-module";
import { desktopToken } from "../di/tokens";

import { ModelsApplication } from "./models-application";

export const MODEL_MANAGER = desktopToken<ModelManager>("models", "manager");

/** Bind the process-scoped Models use cases and analytics orchestration. */
export function modelsModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(ModelsApplication)
      .toDynamicValue(
        (context) =>
          new ModelsApplication(
            context.get<ModelManager>(MODEL_MANAGER),
            context.get(ANALYTICS)
          )
      )
      .inSingletonScope();
  });
}
