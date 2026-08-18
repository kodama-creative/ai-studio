import { NetworkSettingsManager } from "@llm-space/runtime/network";
import type { BrowserWindow } from "electrobun/bun";
import { inject, injectable, preDestroy } from "inversify";

import type { Command } from "../../shared/commands";
import { Analytics } from "../analytics/analytics";
import { DesktopPlaygroundApplication } from "../playgrounds/playground-application";
import { ProjectWindowManager } from "../projects/project-window-manager";
import { UpdaterService } from "../updates/updater-service";

import { DesktopLaunchService } from "./desktop-launch-service";
import {
  DESKTOP_WINDOW_COMMAND_ROUTER,
  type DesktopWindowCommandRouter,
} from "./desktop-window-command-router";
import { type DesktopMainWindowHandle } from "./desktop-window-factory";
import { MainWindowManager } from "./main-window-manager";

/**
 * Own the Desktop process lifecycle after bootstrap has composed every service.
 *
 * The application receives ordinary collaborators and never resolves the DI
 * container. Bootstrap remains the only place that knows how those
 * collaborators are registered and constructed.
 */
@injectable()
export class DesktopApp {
  private _started = false;
  private _stopPromise: Promise<void> | undefined;

  constructor(
    @inject(NetworkSettingsManager)
    private readonly _network: NetworkSettingsManager,
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
  ) {}

  /** Start native routing, background services, restored windows, and events. */
  async start(): Promise<void> {
    if (this._started) {
      throw new Error("Desktop application is already started.");
    }
    this._started = true;

    try {
      this._network.applyToProcessEnvironment();
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
  @preDestroy()
  stop(): Promise<void> {
    return (this._stopPromise ??= this._stop());
  }

  private async _stop(): Promise<void> {
    const errors: unknown[] = [];
    try {
      await this._launch.dispose();
    } catch (error) {
      errors.push(error);
    }

    const windows = await Promise.allSettled([
      this._mainWindows.close(),
      this._projectWindows.closeAll(),
    ]);
    for (const result of windows) {
      if (result.status === "rejected") errors.push(result.reason);
    }

    try {
      await this._playground.dispose();
    } catch (error) {
      errors.push(error);
    }

    if (errors.length > 0) {
      throw new AggregateError(errors, "Failed to stop Desktop application.");
    }
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
