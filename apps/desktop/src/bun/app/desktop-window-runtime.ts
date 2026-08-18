import type { BrowserWindow } from "electrobun/bun";
import { inject, injectable } from "inversify";

import type { Command } from "../../shared/commands";
import { RpcRegistry, type RpcEventSink } from "../di/rpc-registry";
import {
  type NativeWindowStateBinding,
  WindowApplication,
} from "../native/native-window-module";
import {
  createMainWindowRPC,
  type MainWindowRPC,
  type MainWindowRPCController,
} from "../rpc";

export type DesktopWindowKind = "main" | "project";

export const DESKTOP_WINDOW_KIND = Symbol("DesktopWindowKind");

/** Owner callback used when the native window initiates child disposal. */
export const DESKTOP_WINDOW_CLOSE = Symbol("DesktopWindowClose");

export interface DesktopWindowClose {
  requestClose(): void;
}

export interface DesktopWindowCompositionContext {
  readonly kind: DesktopWindowKind;
  readonly rpcEventSink: RpcEventSink;
}

/**
 * Own one window's DI contributions, transport registries, RPC bridge, and
 * native-close handshake as a single lifecycle module.
 */
@injectable()
export class DesktopWindowRuntime {
  private readonly _controller: MainWindowRPCController;
  private _window: BrowserWindow | undefined;
  private _nativeClosed = false;
  private _started = false;
  private _disposePromise: Promise<void> | undefined;

  constructor(
    @inject(DESKTOP_WINDOW_KIND) private readonly _kind: DesktopWindowKind,
    @inject(WindowApplication)
    private readonly _windowApplication: WindowApplication,
    @inject(RpcRegistry) private readonly _rpcRegistry: RpcRegistry,
    @inject(DESKTOP_WINDOW_CLOSE)
    private readonly _close: DesktopWindowClose
  ) {
    this._controller = createMainWindowRPC({
      rpcRegistry: this._rpcRegistry,
    });
  }

  /** Start the fixed RPC contribution snapshot before native creation. */
  start(): void {
    if (this._started) {
      throw new Error(`Desktop ${this._kind} window runtime is already started.`);
    }
    this._rpcRegistry.onStart();
    this._started = true;
  }

  /** Electrobun bridge passed to the native window factory. */
  get rpc(): MainWindowRPC {
    return this._controller.rpc;
  }

  /** Finish window binding after the native factory returns its BrowserWindow. */
  attach(window: BrowserWindow, state: NativeWindowStateBinding): void {
    if (!this._started) {
      throw new Error(`Desktop ${this._kind} window runtime is not started.`);
    }
    if (this._window !== undefined) {
      throw new Error(`Desktop ${this._kind} window runtime is already attached.`);
    }
    this._window = window;
    window.on("close", () => {
      this._nativeClosed = true;
      this._close.requestClose();
    });
    this._windowApplication.attach(window, state);
  }

  /** Dispatch a native menu action into the renderer-owned Command Registry. */
  execute(command: Command): void {
    this._controller.rpc.send.executeCommand(command);
  }

  /** Stop transports before closing the native window. */
  dispose(): Promise<void> {
    this._disposePromise ??= this._dispose();
    return this._disposePromise;
  }

  private async _dispose(): Promise<void> {
    const errors: unknown[] = [];
    for (const resource of [this._rpcRegistry]) {
      try {
        await resource.dispose();
      } catch (error) {
        errors.push(error);
      }
    }
    if (this._window !== undefined && !this._nativeClosed) {
      try {
        this._window.close();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) {
      throw new AggregateError(
        errors,
        `Failed to dispose desktop ${this._kind} window runtime.`
      );
    }
  }
}
