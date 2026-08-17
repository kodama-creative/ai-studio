import { Container } from "inversify";

import type { DesktopWindowContext } from "@/shared/agent-project";
import type { RpcClientTransport } from "@/shared/namespaced-rpc";

import { rendererCommonModule } from "./common-module";
import { RendererApplication } from "./lifecycle";
import { rendererMainWindowModule } from "./main-window-module";
import { rendererProjectWindowModule } from "./project-window-module";

/** Compose one renderer window before resolving its sole lifecycle root. */
export function createRendererWindowContainer(
  context: DesktopWindowContext,
  transport: RpcClientTransport
): Container {
  const container = new Container();
  container.load(rendererCommonModule(transport));
  if (context.kind === "playground") {
    container.load(rendererMainWindowModule(transport));
  } else {
    container.load(rendererProjectWindowModule(context.project, transport));
  }
  container.bind(RendererApplication).toSelf().inSingletonScope();
  return container;
}
