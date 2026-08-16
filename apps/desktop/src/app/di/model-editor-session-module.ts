import { ContainerModule, type ResolutionContext } from "inversify";

import {
  CustomModelEditorController,
  type CustomModelEditorTarget,
} from "../settings/models/custom-model-editor-controller";
import { ImageModelEditorController } from "../settings/models/image-model-editor-controller";

import { MODEL_CATALOG_CONTROLLER } from "./common-module";
import { RENDERER_LIFECYCLE_CONTRIBUTION, RendererScope } from "./lifecycle";
import { rendererToken, resolveRenderer } from "./tokens";

export const CUSTOM_MODEL_EDITOR_TARGET =
  rendererToken<CustomModelEditorTarget>("model-editor", "custom-model-target");
export const CUSTOM_MODEL_EDITOR_CONTROLLER =
  rendererToken<CustomModelEditorController>(
    "model-editor",
    "custom-model-controller"
  );
export const IMAGE_MODEL_EDITOR_TARGET = rendererToken<{
  readonly originalModelId?: string;
}>("model-editor", "image-model-target");
export const IMAGE_MODEL_EDITOR_CONTROLLER =
  rendererToken<ImageModelEditorController>(
    "model-editor",
    "image-model-controller"
  );

function customModelEditorModule(
  target: CustomModelEditorTarget
): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(CUSTOM_MODEL_EDITOR_TARGET).toConstantValue(target);
    bind(CUSTOM_MODEL_EDITOR_CONTROLLER)
      .toDynamicValue((context: ResolutionContext) => {
        const catalog = resolveRenderer(context, MODEL_CATALOG_CONTROLLER);
        return new CustomModelEditorController(
          {
            save: catalog.upsertCustomModel,
            test: (providerId, profileId, candidate) =>
              catalog.testModelConnection(
                providerId,
                candidate.id,
                candidate,
                profileId
              ),
          },
          resolveRenderer(context, CUSTOM_MODEL_EDITOR_TARGET)
        );
      })
      .inSingletonScope();
    bind(RENDERER_LIFECYCLE_CONTRIBUTION).toService(
      CUSTOM_MODEL_EDITOR_CONTROLLER
    );
  });
}

function imageModelEditorModule(originalModelId?: string): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(IMAGE_MODEL_EDITOR_TARGET).toConstantValue({ originalModelId });
    bind(IMAGE_MODEL_EDITOR_CONTROLLER)
      .toDynamicValue((context: ResolutionContext) => {
        const catalog = resolveRenderer(context, MODEL_CATALOG_CONTROLLER);
        const target = resolveRenderer(context, IMAGE_MODEL_EDITOR_TARGET);
        return new ImageModelEditorController(
          { save: catalog.upsertCustomImageModel },
          target.originalModelId
        );
      })
      .inSingletonScope();
    bind(RENDERER_LIFECYCLE_CONTRIBUTION).toService(
      IMAGE_MODEL_EDITOR_CONTROLLER
    );
  });
}

export function createCustomModelEditorScope(
  parent: RendererScope,
  target: CustomModelEditorTarget
): RendererScope {
  return new RendererScope({
    parent,
    modules: [customModelEditorModule(target)],
  });
}

export function createImageModelEditorScope(
  parent: RendererScope,
  originalModelId?: string
): RendererScope {
  return new RendererScope({
    parent,
    modules: [imageModelEditorModule(originalModelId)],
  });
}
