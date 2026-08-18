import { ContainerModule } from "inversify";

import { DesktopApp } from "./desktop-app";

/** Bind the sole Desktop process Application root after every feature module. */
export function desktopAppModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(DesktopApp).toSelf().inSingletonScope();
  });
}
