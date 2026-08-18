import {
  createConfiguredArkImageGenerator,
  type ArkImageGenerationInput,
  type ArkImageGenerationResult,
  ModelManager,
} from "@llm-space/runtime/models";
import { inject, injectable } from "inversify";

import {
  DESKTOP_ENV,
  type DesktopEnvironment,
} from "../app/desktop-paths";

/** Adapt Desktop model configuration to Runtime's Ark image generator. */
@injectable()
export class ArkImageGenerationService {
  private readonly _generate: (
    input: ArkImageGenerationInput
  ) => Promise<ArkImageGenerationResult>;

  constructor(
    @inject(ModelManager) modelManager: ModelManager,
    @inject(DESKTOP_ENV) env: DesktopEnvironment
  ) {
    this._generate = createConfiguredArkImageGenerator({
      modelManager,
      env: { ...env },
    });
  }

  /** Generate one image using the selected persisted Ark model connection. */
  generate(input: ArkImageGenerationInput): Promise<ArkImageGenerationResult> {
    return this._generate(input);
  }
}
