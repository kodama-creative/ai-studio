import { ModelCatalogController } from "@llm-space/ui/host";
import { inject, injectable } from "inversify";

import { DesktopModelClient } from "@/host/model-client";

/** Renderer-owned model catalog configured from the typed Models Service. */
@injectable()
export class DesktopModelCatalogController extends ModelCatalogController {
  constructor(@inject(DesktopModelClient) client: DesktopModelClient) {
    super(client);
  }
}
