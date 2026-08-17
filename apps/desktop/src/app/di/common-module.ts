import { ModelCatalogController, type ModelClient } from "@llm-space/ui/host";
import { ContainerModule, type ResolutionContext } from "inversify";

import { createAppDirectoriesClient } from "@/client/app-directories";
import { createAuxiliaryGenerationClient } from "@/client/auxiliary-generation-client";
import { createBuiltinToolsClient } from "@/client/built-in-tools";
import { createMcpClient, type McpClient } from "@/client/mcp";
import { createModelsClient } from "@/client/models";
import { createNativeDialogsClient } from "@/client/native-dialogs";
import { createNativeFilesClient } from "@/client/native-files";
import { createPromptFilesClient } from "@/client/prompt-files";
import { createSearchClient, type SearchClient } from "@/client/search";
import { createSkillsClient, type SkillsClient } from "@/client/skills";
import { createUpdatesClient } from "@/client/updates";
import { createWindowClient } from "@/client/window";
import { RendererCommandRegistry } from "@/commands/renderer-command-registry";
import { createElectrobunModelClient } from "@/host/model-client";
import type { ModelsRequests } from "@/shared/models-rpc";

import { RendererEventEffects } from "../events/renderer-event-effects";
import {
  createRendererEventEmitter,
  type RendererEventEmitter,
} from "../events/renderer-events";
import { FullScreenController } from "../window/full-screen-controller";

import { RENDERER_LIFECYCLE_CONTRIBUTION } from "./lifecycle";
import { rendererToken } from "./tokens";

export const RENDERER_EVENTS = rendererToken<RendererEventEmitter>(
  "events",
  "emitter"
);
export const RENDERER_COMMAND_REGISTRY = rendererToken<RendererCommandRegistry>(
  "commands",
  "registry"
);
export const RENDERER_EVENT_EFFECTS = rendererToken<RendererEventEffects>(
  "events",
  "effects"
);
export const MODELS_CLIENT = rendererToken<ModelsRequests>("models", "client");
export const MODEL_CLIENT = rendererToken<ModelClient>("models", "host-client");
export const MODEL_CATALOG_CONTROLLER = rendererToken<ModelCatalogController>(
  "models",
  "catalog-controller"
);
export const WINDOW_CLIENT = rendererToken<
  ReturnType<typeof createWindowClient>
>("window", "client");
export const FULL_SCREEN_CONTROLLER = rendererToken<FullScreenController>(
  "window",
  "full-screen-controller"
);
export const UPDATES_CLIENT = rendererToken<
  ReturnType<typeof createUpdatesClient>
>("updates", "client");
export const MCP_CLIENT = rendererToken<McpClient>("mcp", "client");
export const SKILLS_CLIENT = rendererToken<SkillsClient>("skills", "client");
export const SEARCH_CLIENT = rendererToken<SearchClient>("search", "client");
export const APP_DIRECTORIES_CLIENT = rendererToken<
  ReturnType<typeof createAppDirectoriesClient>
>("app-directories", "client");
export const AUXILIARY_GENERATION_CLIENT = rendererToken<
  ReturnType<typeof createAuxiliaryGenerationClient>
>("auxiliary-generation", "client");
export const BUILTIN_TOOLS_CLIENT = rendererToken<
  ReturnType<typeof createBuiltinToolsClient>
>("builtin-tools", "client");
export const NATIVE_DIALOGS_CLIENT = rendererToken<
  ReturnType<typeof createNativeDialogsClient>
>("native-dialogs", "client");
export const NATIVE_FILES_CLIENT = rendererToken<
  ReturnType<typeof createNativeFilesClient>
>("native-files", "client");
export const PROMPT_FILES_CLIENT = rendererToken<
  ReturnType<typeof createPromptFilesClient>
>("prompt-files", "client");

export function rendererCommonModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(RENDERER_EVENTS).toConstantValue(createRendererEventEmitter());
    bind(RENDERER_EVENT_EFFECTS)
      .toDynamicValue(
        (context: ResolutionContext) =>
          new RendererEventEffects(context.get(RENDERER_EVENTS))
      )
      .inSingletonScope();
    bind(RENDERER_LIFECYCLE_CONTRIBUTION).toService(RENDERER_EVENT_EFFECTS);
    bind(RENDERER_COMMAND_REGISTRY)
      .toDynamicValue(() => new RendererCommandRegistry())
      .inSingletonScope();
    bind(RENDERER_LIFECYCLE_CONTRIBUTION).toService(RENDERER_COMMAND_REGISTRY);

    bind(MODELS_CLIENT).toConstantValue(createModelsClient());
    bind(MODEL_CLIENT)
      .toDynamicValue((context: ResolutionContext) =>
        createElectrobunModelClient(context.get(MODELS_CLIENT))
      )
      .inSingletonScope();
    bind(MODEL_CATALOG_CONTROLLER)
      .toDynamicValue(
        (context: ResolutionContext) =>
          new ModelCatalogController(context.get(MODEL_CLIENT))
      )
      .inSingletonScope();
    bind(RENDERER_LIFECYCLE_CONTRIBUTION).toService(MODEL_CATALOG_CONTROLLER);

    bind(WINDOW_CLIENT).toConstantValue(createWindowClient());
    bind(FULL_SCREEN_CONTROLLER)
      .toDynamicValue(
        (context: ResolutionContext) =>
          new FullScreenController(context.get(WINDOW_CLIENT))
      )
      .inSingletonScope();
    bind(RENDERER_LIFECYCLE_CONTRIBUTION).toService(FULL_SCREEN_CONTROLLER);

    bind(UPDATES_CLIENT).toConstantValue(createUpdatesClient());
    bind(MCP_CLIENT).toConstantValue(createMcpClient());
    bind(SKILLS_CLIENT).toConstantValue(createSkillsClient());
    bind(SEARCH_CLIENT).toConstantValue(createSearchClient());
    bind(APP_DIRECTORIES_CLIENT).toConstantValue(createAppDirectoriesClient());
    bind(AUXILIARY_GENERATION_CLIENT).toConstantValue(
      createAuxiliaryGenerationClient()
    );
    bind(BUILTIN_TOOLS_CLIENT).toConstantValue(createBuiltinToolsClient());
    bind(NATIVE_DIALOGS_CLIENT).toConstantValue(createNativeDialogsClient());
    bind(NATIVE_FILES_CLIENT).toConstantValue(createNativeFilesClient());
    bind(PROMPT_FILES_CLIENT).toConstantValue(createPromptFilesClient());
  });
}
