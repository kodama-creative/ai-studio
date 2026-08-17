import { Utils } from "electrobun/bun";
import { injectable } from "inversify";

import type { DesktopLaunchErrorReporter } from "./desktop-launch-service";

/** Report contained launch failures to diagnostics and the native user surface. */
@injectable()
export class DesktopLaunchErrorReporterService
  implements DesktopLaunchErrorReporter
{
  /** Show one safe native notification after preserving the full local error. */
  report(error: Error): void {
    console.error("Failed to handle deep link:", error);
    Utils.showNotification({
      title: "Unable to Open Agent Project",
      body: error.message,
    });
  }
}
