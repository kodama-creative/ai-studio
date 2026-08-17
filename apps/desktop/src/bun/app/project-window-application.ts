import type { BrowserWindow } from "electrobun/bun";
import { inject, injectable, preDestroy } from "inversify";

import type { Command } from "../../shared/commands";
import { ProjectService } from "../projects/project-module";
import type { MainWindowRPC } from "../rpc";

import { DesktopWindowRuntime } from "./desktop-window-runtime";
import {
  NATIVE_WINDOW_FACTORY,
  type NativeWindowFactory,
} from "./native-window-factory";
import type { DesktopWindowApplication } from "./window-application";

/** Sole lifecycle root for one Project child Container. */
@injectable()
export class ProjectWindowApplication implements DesktopWindowApplication {
  private _startPromise: Promise<BrowserWindow> | undefined;
  private _stopPromise: Promise<void> | undefined;

  constructor(
    @inject(ProjectService) private readonly _project: ProjectService,
    @inject(DesktopWindowRuntime)
    private readonly _runtime: DesktopWindowRuntime,
    @inject(NATIVE_WINDOW_FACTORY)
    private readonly _native: NativeWindowFactory
  ) {}

  get rpc(): MainWindowRPC {
    return this._runtime.rpc;
  }

  /** Start Project resources before exposing RPC or creating its renderer. */
  start(): Promise<BrowserWindow> {
    this._startPromise ??= this._start();
    return this._startPromise;
  }

  /** Stop Project and window resources in their required business order. */
  @preDestroy()
  stop(): Promise<void> {
    this._stopPromise ??= this._stop();
    return this._stopPromise;
  }

  /** Forward one native menu intent to this renderer window. */
  execute(command: Command): void {
    this._runtime.execute(command);
  }

  private async _start(): Promise<BrowserWindow> {
    await this._project.start();
    try {
      this._runtime.start();
      return await this._native.create(
        this._project.getWindowContext(),
        this._runtime.rpc,
        (window, state) => this._runtime.attach(window, state)
      );
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  private async _stop(): Promise<void> {
    const errors: unknown[] = [];
    try {
      await this._runtime.dispose();
    } catch (error) {
      errors.push(error);
    }
    try {
      await this._project.stop();
    } catch (error) {
      errors.push(error);
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, "Failed to stop Project window.");
    }
  }
}
