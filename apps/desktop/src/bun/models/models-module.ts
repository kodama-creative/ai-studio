import type { ModelManager } from "@llm-space/runtime/models";
import { ContainerModule } from "inversify";

import { ANALYTICS } from "../analytics/analytics-module";
import { desktopToken } from "../di/tokens";
import { bindWindowFeature, windowFeature } from "../di/window-feature";

import { ModelsApplication } from "./models-application";
import { modelsRpcModule } from "./models-rpc-feature";

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
    bindWindowFeature(
      bind,
      windowFeature("models", (scope) => scope.load(modelsRpcModule()))
    );
  });
}
