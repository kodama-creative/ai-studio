import type { BrowserWindow } from "electrobun/bun";
import { inject, injectable, preDestroy } from "inversify";

import type { Command } from "../../shared/commands";
import type { MainWindowRPC } from "../rpc";

import { DesktopWindowRuntime } from "./desktop-window-runtime";
import {
  NATIVE_WINDOW_FACTORY,
  type NativeWindowFactory,
} from "./native-window-factory";
import type { DesktopWindowApplication } from "./window-application";

/** Sole lifecycle root for one Main child Container. */
@injectable()
export class MainWindowApplication implements DesktopWindowApplication {
  private _startPromise: Promise<BrowserWindow> | undefined;

  constructor(
    @inject(DesktopWindowRuntime)
    private readonly _runtime: DesktopWindowRuntime,
    @inject(NATIVE_WINDOW_FACTORY)
    private readonly _native: NativeWindowFactory
  ) {}

  get rpc(): MainWindowRPC {
    return this._runtime.rpc;
  }

  /** Start RPC before creating and attaching the native Main window. */
  start(): Promise<BrowserWindow> {
    this._startPromise ??= this._start();
    return this._startPromise;
  }

  /** Stop transports and the native window before Container unbinding. */
  @preDestroy()
  stop(): Promise<void> {
    return this._runtime.dispose();
  }

  /** Forward one native menu intent to this renderer window. */
  execute(command: Command): void {
    this._runtime.execute(command);
  }

  private async _start(): Promise<BrowserWindow> {
    this._runtime.start();
    try {
      return await this._native.create(
        { kind: "playground" },
        this._runtime.rpc,
        (window, state) => this._runtime.attach(window, state)
      );
    } catch (error) {
      await this._runtime.dispose();
      throw error;
    }
  }
}
