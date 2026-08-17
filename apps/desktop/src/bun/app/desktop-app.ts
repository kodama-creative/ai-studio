import Electrobun, { app, type ElectrobunEvent } from "electrobun/bun";

import type { Analytics } from "../analytics";
import type { ProjectWindowManager } from "../projects/project-window-manager";
import type { UpdaterService } from "../updates";

import type { DesktopLaunchController } from "./desktop-launch-controller";
import {
  type DesktopAppRuntime,
  DesktopLifecycle,
} from "./desktop-lifecycle";
import type {
  DesktopMainWindowHandle,
  DesktopWindowFactory,
} from "./desktop-window-factory";
import type { MainWindowManager } from "./main-window-manager";
import { registerMenuActions } from "./menu";
import { createShutdownCoordinator } from "./shutdown-coordinator";

export interface DesktopAppOptions {
  readonly analytics: Analytics;
  readonly updater: UpdaterService;
  readonly launch: DesktopLaunchController;
  readonly mainWindows: MainWindowManager<DesktopMainWindowHandle>;
  readonly projectWindows: ProjectWindowManager;
  readonly windowFactory: DesktopWindowFactory;
  readonly stopProcess: () => Promise<void>;
}

/**
 * Own the Desktop process lifecycle after bootstrap has composed every service.
 *
 * The application receives ordinary collaborators and never resolves the DI
 * container. Bootstrap remains the only place that knows how those
 * collaborators are registered and constructed.
 */
export class DesktopApp implements DesktopAppRuntime {
  private readonly _lifecycle = new DesktopLifecycle();
  private _started = false;

  constructor(private readonly _options: DesktopAppOptions) {
    // Registration order mirrors ownership; DesktopLifecycle stops in reverse.
    this._lifecycle.defer("desktop process scope", _options.stopProcess);
    this._lifecycle.defer("agent project windows", () =>
      _options.projectWindows.closeAll()
    );
    this._lifecycle.defer("desktop launch", () => _options.launch.dispose());
  }

  /** Start native routing, background services, restored windows, and events. */
  async start(): Promise<void> {
    if (this._started) {
      throw new Error("Desktop application is already started.");
    }
    this._started = true;

    try {
      registerMenuActions(
        () => this._options.mainWindows.current()?.window,
        (command, window) =>
          this._options.windowFactory.executeCommand(command, window)
      );
      await this._options.launch.start();

      this._options.analytics.capture("app_opened", {
        isFirstOpen: this._options.analytics.isFirstRun,
      });
      void this._options.updater.start();
      await this._options.projectWindows.restoreProjects();

      const handleBeforeQuit = createShutdownCoordinator({
        quit: () => app.quit(),
        stop: () => this.stop(),
      });
      Electrobun.events.on(
        "before-quit",
        (event: ElectrobunEvent<{}, { allow: boolean }>) =>
          handleBeforeQuit(event)
      );
      Electrobun.events.on("reopen", () => {
        this._options.launch.reopen();
      });
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  /** Stop launch routing, native windows, and the process scope exactly once. */
  stop(): Promise<void> {
    return this._lifecycle.stop();
  }
}
