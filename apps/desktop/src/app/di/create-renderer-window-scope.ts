import type { DesktopWindowContext } from "@/shared/agent-project";

import { rendererCommonModule } from "./common-module";
import { RendererScope } from "./lifecycle";
import { rendererMainWindowModule } from "./main-window-module";
import { rendererProjectWindowModule } from "./project-window-module";

export function createRendererWindowScope(
  context: DesktopWindowContext
): RendererScope {
  return new RendererScope({
    modules: [
      rendererCommonModule(),
      ...(context.kind === "playground" ? [rendererMainWindowModule()] : []),
      ...(context.kind === "agentProject"
        ? [rendererProjectWindowModule(context.project)]
        : []),
    ],
  });
}
