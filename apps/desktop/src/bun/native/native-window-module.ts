import type { BrowserWindow } from "electrobun/bun";
import { ContainerModule } from "inversify";

import type { DesktopWindowContext } from "../../shared/agent-project";
import type { Disposable } from "../../shared/disposable";
import { EventHub } from "../../shared/event-hub";
import type { RpcServer } from "../../shared/namespaced-rpc";
import {
  WINDOW_RPC,
  type WindowEvents,
  type WindowRequests,
  type WindowRpc,
} from "../../shared/window-rpc";
import type {
  WindowStateManager,
  WindowStatePersistenceStore,
} from "../app/window-state";
import {
  CommandContribution,
  type CommandContribution as CommandContributionApi,
} from "../di/command-contribution";
import type { CommandRegistry } from "../di/command-registry";
import {
  RpcContribution,
  type RpcContribution as RpcContributionApi,
} from "../di/rpc-contribution";
import type { RpcRegistry } from "../di/rpc-registry";
import { desktopToken } from "../di/tokens";
import { bindWindowFeature, windowFeature } from "../di/window-feature";

const ZOOM_STEP = 0.1;

function _clampZoom(zoom: number): number {
  return Math.min(3, Math.max(0.3, zoom));
}

export const WINDOW_APPLICATION =
  desktopToken<WindowApplication>("window", "application");
export const WINDOW_CONTEXT =
  desktopToken<DesktopWindowContext>("window", "context");
export const WINDOW_STATE_MANAGER = desktopToken<WindowStateManager>(
  "window",
  "state-manager"
);

export interface NativeWindowStateBinding {
  readonly store: WindowStatePersistenceStore;
  readonly isMaximized?: boolean;
  readonly isFullScreen?: boolean;
  readonly zoom?: number;
}

export class WindowApplication implements WindowRequests, Disposable {
  readonly events = new EventHub<WindowEvents>();
  private _window: BrowserWindow | undefined;

  constructor(
    private readonly _context: DesktopWindowContext,
    private readonly _windowStates: WindowStateManager
  ) {}

  /** Attach the single native window owned by this application instance. */
  attach(window: BrowserWindow, state: NativeWindowStateBinding): void {
    if (this._window !== undefined) {
      throw new Error("Native window is already attached.");
    }
    this._windowStates.attach(window, {
      ...state,
      onFullScreenChange: (fullScreen) =>
        this._notifyFullScreenChanged(fullScreen),
    });
    this._window = window;
  }

  getContext() {
    return Promise.resolve(this._context);
  }

  toggleMaximized() {
    const window = this._requireWindow();
    if (window.isMaximized()) window.unmaximize();
    else window.maximize();
  }

  zoomIn(): void {
    this._changeZoom(ZOOM_STEP);
  }

  zoomOut(): void {
    this._changeZoom(-ZOOM_STEP);
  }

  resetZoom(): void {
    this._setZoom(1);
  }

  reload(): void {
    this._requireWindow().webview?.executeJavascript("location.reload()");
  }

  getFullscreenState() {
    return Promise.resolve({ fullScreen: this._requireWindow().isFullScreen() });
  }

  /** Publish a native fullscreen transition to the owning renderer. */
  private _notifyFullScreenChanged(fullScreen: boolean): void {
    this.events.publish("fullScreenChanged", { fullScreen });
  }

  /** Release listeners owned by this native window. */
  dispose(): void {
    this.events.dispose();
  }

  private _changeZoom(delta: number): void {
    this._setZoom(_clampZoom(this._requireWindow().getPageZoom() + delta));
  }

  private _setZoom(zoom: number): void {
    const window = this._requireWindow();
    window.setPageZoom(zoom);
    this._windowStates.saveZoom(window, zoom);
  }

  private _requireWindow(): BrowserWindow {
    if (this._window === undefined) {
      throw new Error("Native window is not attached.");
    }
    return this._window;
  }
}

class WindowRpcServer implements RpcServer<WindowRpc> {
  readonly namespace = WINDOW_RPC;
  readonly streams = {};
  readonly eventSource: EventHub<WindowEvents>;

  constructor(readonly requests: WindowRequests, events: EventHub<WindowEvents>) {
    this.eventSource = events;
  }
}

class WindowContribution implements CommandContributionApi, RpcContributionApi {
  constructor(private readonly _application: WindowApplication) {}

  registerRpc(rpc: RpcRegistry): void {
    rpc.registerServer(
      new WindowRpcServer(this._application, this._application.events)
    );
  }

  registerCommands(commands: CommandRegistry): void {
    commands.registerCommand("window.toggleMaximized", {
      execute: () => this._application.toggleMaximized(),
    });
    commands.registerCommand("window.zoomIn", {
      execute: () => this._application.zoomIn(),
    });
    commands.registerCommand("window.zoomOut", {
      execute: () => this._application.zoomOut(),
    });
    commands.registerCommand("window.resetZoom", {
      execute: () => this._application.resetZoom(),
    });
    commands.registerCommand("window.reload", {
      execute: () => this._application.reload(),
    });
  }
}

/** Bind the Window application, RPC, and commands for one native window. */
export function nativeWindowContributionsModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind<WindowApplication>(WINDOW_APPLICATION)
      .toDynamicValue(
        (context) =>
          new WindowApplication(
            context.get(WINDOW_CONTEXT),
            context.get(WINDOW_STATE_MANAGER)
          )
      )
      .inSingletonScope();
    bind(WindowContribution)
      .toDynamicValue(
        (context) =>
          new WindowContribution(
            context.get(WINDOW_APPLICATION)
          )
      )
      .inSingletonScope();
    bind<CommandContributionApi>(CommandContribution).toService(
      WindowContribution
    );
    bind<RpcContributionApi>(RpcContribution).toService(WindowContribution);
  });
}

/** Register native window commands/state as one bundled window feature. */
export function nativeWindowModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bindWindowFeature(
      bind,
      windowFeature("native-window", (scope) =>
        scope.load(nativeWindowContributionsModule())
      )
    );
  });
}
