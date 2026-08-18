import type { BrowserWindow } from "electrobun/bun";
import { inject, injectable } from "inversify";

import type { Command } from "../../shared/commands";
import { Analytics } from "../analytics";
import { DesktopPlaygroundApplication } from "../playgrounds/playground-application";
import { ProjectWindowManager } from "../projects/project-window-manager";
import { UpdaterService } from "../updates";

import { DesktopLaunchService } from "./desktop-launch-service";
import {
  type DesktopAppRuntime,
  DesktopLifecycle,
} from "./desktop-lifecycle";
import {
  DESKTOP_WINDOW_COMMAND_ROUTER,
  type DesktopWindowCommandRouter,
} from "./desktop-window-command-router";
import {
  type DesktopMainWindowHandle,
} from "./desktop-window-factory";
import { MainWindowManager } from "./main-window-manager";

/**
 * Own the Desktop process lifecycle after bootstrap has composed every service.
 *
 * The application receives ordinary collaborators and never resolves the DI
 * container. Bootstrap remains the only place that knows how those
 * collaborators are registered and constructed.
 */
@injectable()
export class DesktopApp implements DesktopAppRuntime {
  private readonly _lifecycle = new DesktopLifecycle();
  private _started = false;

  constructor(
    @inject(Analytics) private readonly _analytics: Analytics,
    @inject(UpdaterService) private readonly _updater: UpdaterService,
    @inject(DesktopPlaygroundApplication)
    private readonly _playground: DesktopPlaygroundApplication,
    @inject(DesktopLaunchService)
    private readonly _launch: DesktopLaunchService,
    @inject(MainWindowManager)
    private readonly _mainWindows: MainWindowManager<DesktopMainWindowHandle>,
    @inject(ProjectWindowManager)
    private readonly _projectWindows: ProjectWindowManager,
    @inject(DESKTOP_WINDOW_COMMAND_ROUTER)
    private readonly _windowCommands: DesktopWindowCommandRouter
  ) {
    // Registration order mirrors ownership; DesktopLifecycle stops in reverse.
    this._lifecycle.defer("playground", () => this._playground.dispose());
    this._lifecycle.defer("main window", () => this._mainWindows.close());
    this._lifecycle.defer("agent project windows", () =>
      this._projectWindows.closeAll()
    );
    this._lifecycle.defer("desktop launch", () => this._launch.dispose());
  }

  /** Start native routing, background services, restored windows, and events. */
  async start(): Promise<void> {
    if (this._started) {
      throw new Error("Desktop application is already started.");
    }
    this._started = true;

    try {
      await this._launch.start();

      this._analytics.capture("app_opened", {
        isFirstOpen: this._analytics.isFirstRun,
      });
      void this._updater.start();
      await this._projectWindows.restoreProjects();
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  /** Stop launch routing, native windows, and the process scope exactly once. */
  stop(): Promise<void> {
    return this._lifecycle.stop();
  }

  /** Route a native reopen through the already-resolved Application graph. */
  reopen(): void {
    this._launch.reopen();
  }

  /** Return the live Main native handle used as the default menu target. */
  currentMainWindow(): BrowserWindow | undefined {
    return this._mainWindows.current()?.window;
  }

  /** Forward one native menu intent to the target renderer Command Registry. */
  executeCommand(command: Command, window: BrowserWindow): void {
    this._windowCommands.executeCommand(command, window);
  }
}
