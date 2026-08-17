import { inject, injectable } from "inversify";

import type { Disposable } from "@/shared/disposable";
import {
  MODELS_SERVICE,
  type ModelsRpc,
} from "@/shared/models-rpc";
import type { RpcClient } from "@/shared/namespaced-rpc";

import { DesktopModelCatalogController } from "./desktop-model-catalog-controller";

/** Refresh the renderer catalog when another window commits Model settings. */
@injectable()
export class ModelsChangeController {
  private _subscription: Disposable | undefined;

  constructor(
    @inject(MODELS_SERVICE)
    private readonly _models: RpcClient<ModelsRpc>,
    @inject(DesktopModelCatalogController)
    private readonly _catalog: DesktopModelCatalogController
  ) {}

  /** Subscribe once to committed Models changes and refresh the local catalog. */
  start(): void {
    if (this._subscription !== undefined) return;
    this._subscription = this._models.on("changed", () => {
      void this._catalog.refresh();
    });
  }

  /** Release the Models event subscription owned by this renderer. */
  stop(): void {
    void this._subscription?.dispose();
    this._subscription = undefined;
  }
}
