import type { BrowserWindow } from "electrobun/bun";

import type { Command } from "../../shared/commands";
import { CommandRegistry, type CommandSink } from "../di/command-registry";
import type { DesktopWindowScope } from "../di/process-container";
import { RpcRegistry, type RpcEventSink } from "../di/rpc-registry";
import {
  type NativeWindowStateBinding,
  WINDOW_APPLICATION,
  type WindowApplication,
} from "../native/native-window-module";
import {
  createMainWindowRPC,
  type MainWindowRPC,
  type MainWindowRPCController,
} from "../rpc";

export type DesktopWindowKind = "main" | "project";

export interface DesktopWindowCompositionContext {
  readonly kind: DesktopWindowKind;
  readonly commandSink: CommandSink;
  readonly rpcEventSink: RpcEventSink;
}

export type ConfigureDesktopWindowScope = (
  scope: DesktopWindowScope,
  context: DesktopWindowCompositionContext
) => void;

/**
 * Own one window's DI contributions, transport registries, RPC bridge, and
 * native-close handshake as a single lifecycle module.
 */
export class DesktopWindowRuntime {
  private readonly _commands: CommandRegistry;
  private readonly _rpcRegistry: RpcRegistry;
  private readonly _controller: MainWindowRPCController;
  private readonly _windowApplication: WindowApplication;
  private _window: BrowserWindow | undefined;
  private _nativeClosed = false;
  private _disposePromise: Promise<void> | undefined;

  constructor(
    private readonly _scope: DesktopWindowScope,
    private readonly _kind: DesktopWindowKind,
    configureScope: ConfigureDesktopWindowScope
  ) {
    const rpcBridge: { current?: MainWindowRPC } = {};
    const requireRpcBridge = (): MainWindowRPC => {
      if (rpcBridge.current === undefined) {
        throw new Error(`RPC bridge for ${_kind} window is not ready.`);
      }
      return rpcBridge.current;
    };
    const commandSink: CommandSink = {
      sendToWebview: (command) =>
        requireRpcBridge().send.executeCommand(command),
    };
    const rpcEventSink: RpcEventSink = {
      sendStreamEvent: (event) =>
        requireRpcBridge().send.rpcNamespaceStreamEvent(event),
      sendEvent: (event) =>
        requireRpcBridge().send.rpcNamespaceEvent(event),
    };

    // The production composition root decides which modules belong to this
    // window. The child scope remains the instance and lifecycle boundary.
    configureScope(_scope, {
      kind: _kind,
      commandSink,
      rpcEventSink,
    });
    this._windowApplication = _scope.get(WINDOW_APPLICATION);
    this._commands = _scope.get(CommandRegistry);
    this._rpcRegistry = _scope.get(RpcRegistry);
    this._commands.onStart();
    this._rpcRegistry.onStart();
    this._controller = createMainWindowRPC({
      executeCommand: (command) => this._commands.execute(command),
      rpcRegistry: this._rpcRegistry,
    });
    rpcBridge.current = this._controller.rpc;
    _scope.onDispose(() => this.dispose());
  }

  /** Electrobun bridge passed to the native window factory. */
  get rpc(): MainWindowRPC {
    return this._controller.rpc;
  }

  /** Finish window binding after the native factory returns its BrowserWindow. */
  attach(window: BrowserWindow, state: NativeWindowStateBinding): void {
    if (this._window !== undefined) {
      throw new Error(`Desktop ${this._kind} window runtime is already attached.`);
    }
    this._window = window;
    window.on("close", () => {
      this._nativeClosed = true;
      void this._scope.dispose().catch((error) => {
        console.error(
          `Failed to dispose window scope "${this._scope.id}":`,
          error
        );
      });
    });
    this._windowApplication.attach(window, state);
  }

  /** Dispatch a native menu action into this window's command registry. */
  execute(command: Command): void {
    this._commands.execute(command);
  }

  /** Stop transports before closing the native window. */
  dispose(): Promise<void> {
    this._disposePromise ??= this._dispose();
    return this._disposePromise;
  }

  private async _dispose(): Promise<void> {
    const errors: unknown[] = [];
    for (const resource of [this._rpcRegistry, this._commands]) {
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
