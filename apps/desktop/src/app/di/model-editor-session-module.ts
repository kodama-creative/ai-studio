import { Container, ContainerModule } from "inversify";

import {
  CUSTOM_MODEL_EDITOR_TARGET,
  CustomModelEditorController,
  type CustomModelEditorTarget,
} from "../settings/models/custom-model-editor-controller";
import {
  IMAGE_MODEL_EDITOR_TARGET,
  ImageModelEditorController,
} from "../settings/models/image-model-editor-controller";

import {
  createRendererSessionContainer,
  RENDERER_LIFECYCLE_CONTRIBUTION,
  RENDERER_SESSION_APPLICATION,
  RendererApplication,
} from "./lifecycle";

export const CUSTOM_MODEL_EDITOR_CONTROLLER = CustomModelEditorController;
export const IMAGE_MODEL_EDITOR_CONTROLLER = ImageModelEditorController;

function customModelEditorModule(
  target: CustomModelEditorTarget
): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(RendererApplication).toSelf().inSingletonScope();
    bind(RENDERER_SESSION_APPLICATION).toService(RendererApplication);
    bind(CUSTOM_MODEL_EDITOR_TARGET).toConstantValue(target);
    bind(CustomModelEditorController).toSelf().inSingletonScope();
    bind(RENDERER_LIFECYCLE_CONTRIBUTION).toService(
      CUSTOM_MODEL_EDITOR_CONTROLLER
    );
  });
}

function imageModelEditorModule(originalModelId?: string): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(RendererApplication).toSelf().inSingletonScope();
    bind(RENDERER_SESSION_APPLICATION).toService(RendererApplication);
    bind(IMAGE_MODEL_EDITOR_TARGET).toConstantValue({ originalModelId });
    bind(ImageModelEditorController).toSelf().inSingletonScope();
    bind(RENDERER_LIFECYCLE_CONTRIBUTION).toService(
      IMAGE_MODEL_EDITOR_CONTROLLER
    );
  });
}

export function createCustomModelEditorContainer(
  parent: Container,
  target: CustomModelEditorTarget
): Container {
  return createRendererSessionContainer(parent, [
    customModelEditorModule(target),
  ]);
}

export function createImageModelEditorContainer(
  parent: Container,
  originalModelId?: string
): Container {
  return createRendererSessionContainer(parent, [
    imageModelEditorModule(originalModelId),
  ]);
}
