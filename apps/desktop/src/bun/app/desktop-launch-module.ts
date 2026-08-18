import { ContainerModule } from "inversify";

import { DesktopLaunchErrorReporterService } from "./desktop-launch-error-reporter";
import {
  DESKTOP_LAUNCH_ERROR_REPORTER,
  DESKTOP_LAUNCH_TARGETS,
  DesktopLaunchService,
} from "./desktop-launch-service";
import { DesktopLaunchTargetService } from "./desktop-launch-targets";

/** Bind process-owned cold-start, deep-link, and native-reopen routing. */
export function desktopLaunchModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(DesktopLaunchTargetService).toSelf().inSingletonScope();
    bind(DESKTOP_LAUNCH_TARGETS).toService(DesktopLaunchTargetService);
    bind(DesktopLaunchErrorReporterService).toSelf().inSingletonScope();
    bind(DESKTOP_LAUNCH_ERROR_REPORTER).toService(
      DesktopLaunchErrorReporterService
    );
    bind(DesktopLaunchService).toSelf().inSingletonScope();
  });
}
