import { ContainerModule } from "inversify";

import { DESKTOP_WINDOW_COMMAND_ROUTER } from "./desktop-window-command-router";
import { DesktopWindowFactory } from "./desktop-window-factory";
import { MainWindowManager } from "./main-window-manager";
import { WINDOW_CONTAINER_FACTORY } from "./window-container-factory";

/** Bind process-owned creation and routing for native window child Containers. */
export function desktopWindowModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(DesktopWindowFactory).toSelf().inSingletonScope();
    bind(WINDOW_CONTAINER_FACTORY).toService(DesktopWindowFactory);
    bind(DESKTOP_WINDOW_COMMAND_ROUTER).toService(DesktopWindowFactory);
    bind(MainWindowManager).toSelf().inSingletonScope();
  });
}
