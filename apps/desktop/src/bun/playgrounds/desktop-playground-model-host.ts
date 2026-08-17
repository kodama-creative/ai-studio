import { ModelManager } from "@llm-space/runtime/models";
import { inject, injectable } from "inversify";

import {
  PLAYGROUND_MODEL_HOST,
  type PlaygroundModelHost,
} from "./playground-application";

/** Adapts process Models into the frozen Playground execution host seam. */
@injectable()
export class DesktopPlaygroundModelHost implements PlaygroundModelHost {
  readonly models;

  constructor(@inject(ModelManager) private readonly _models: ModelManager) {
    this.models = () => this._models.getAvailableModels();
  }

  /** Resolve the current provider connection for a newly admitted operation. */
  resolveConnection: NonNullable<PlaygroundModelHost["resolveConnection"]> = ({
    providerId,
  }) => this._models.resolveConnection({ providerId });
}

export { PLAYGROUND_MODEL_HOST };
