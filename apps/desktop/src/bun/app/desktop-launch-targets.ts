import { inject, injectable } from "inversify";

import type { DeepLinkScheme } from "../../shared/deep-link-scheme";
import { activateWindowForDeepLink } from "../deep-link/activate-window";
import { ProjectWindowManager } from "../projects/project-window-manager";

import {
  DESKTOP_DEEP_LINK_SCHEME,
  type DesktopLaunchTargets,
} from "./desktop-launch-service";
import type { DesktopMainWindowHandle } from "./desktop-window-factory";
import { MainWindowManager } from "./main-window-manager";

/** Route launch intents through the process-owned Main and Project managers. */
@injectable()
export class DesktopLaunchTargetService implements DesktopLaunchTargets {
  constructor(
    @inject(MainWindowManager)
    private readonly _main: MainWindowManager<DesktopMainWindowHandle>,
    @inject(ProjectWindowManager)
    private readonly _projects: ProjectWindowManager,
    @inject(DESKTOP_DEEP_LINK_SCHEME)
    private readonly _scheme: DeepLinkScheme
  ) {}

  /** Open Main and optionally activate a deep link after native creation. */
  async openMain(url?: string): Promise<void> {
    const main = await this._main.open();
    if (url !== undefined) {
      activateWindowForDeepLink(main.window, url, this._scheme);
    }
  }

  /** Open or activate the isolated Project window for one source root. */
  openProject(rootPath: string): Promise<void> {
    return this._projects.openProject(rootPath);
  }
}
