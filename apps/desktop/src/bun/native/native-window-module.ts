import type { BrowserWindow } from "electrobun/bun";
import {
  ContainerModule,
  inject,
  injectable,
  preDestroy,
} from "inversify";

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
import {
  RpcContribution,
  type RpcContribution as RpcContributionApi,
} from "../di/rpc-contribution";
import type { RpcRegistry } from "../di/rpc-registry";

import {
  WindowStateController,
  type WindowStatePersistenceStore,
} from "./window-state-controller";

const ZOOM_STEP = 0.1;

function _clampZoom(zoom: number): number {
  return Math.min(3, Math.max(0.3, zoom));
}

export const WINDOW_CONTEXT_PROVIDER = Symbol("WindowContextProvider");

export interface NativeWindowStateBinding {
  readonly store: WindowStatePersistenceStore;
  readonly isMaximized?: boolean;
  readonly isFullScreen?: boolean;
  readonly zoom?: number;
}

export interface WindowContextProvider {
  getWindowContext(): DesktopWindowContext;
}

@injectable()
export class WindowApplication implements WindowRequests, Disposable {
  readonly events = new EventHub<WindowEvents>();
  private _window: BrowserWindow | undefined;
  private _fullScreenSubscription: Disposable | undefined;

  constructor(
    @inject(WINDOW_CONTEXT_PROVIDER)
    private readonly _context: WindowContextProvider,
    @inject(WindowStateController)
    private readonly _windowState: WindowStateController
  ) {}

  /** Attach the single native window owned by this application instance. */
  attach(window: BrowserWindow, state: NativeWindowStateBinding): void {
    if (this._window !== undefined) {
      throw new Error("Native window is already attached.");
    }
    const fullScreenSubscription = this._windowState.onDidChangeFullScreen(
      (fullScreen) => this._notifyFullScreenChanged(fullScreen)
    );
    try {
      this._windowState.attach(window, state.store, {
        isMaximized: state.isMaximized,
        isFullScreen: state.isFullScreen,
        zoom: state.zoom ?? 1,
      });
    } catch (error) {
      void fullScreenSubscription.dispose();
      throw error;
    }
    this._fullScreenSubscription = fullScreenSubscription;
    this._window = window;
  }

  getContext() {
    return Promise.resolve(this._context.getWindowContext());
  }

  toggleMaximized(): Promise<void> {
    const window = this._requireWindow();
    if (window.isMaximized()) window.unmaximize();
    else window.maximize();
    return Promise.resolve();
  }

  zoomIn(): Promise<void> {
    this._changeZoom(ZOOM_STEP);
    return Promise.resolve();
  }

  zoomOut(): Promise<void> {
    this._changeZoom(-ZOOM_STEP);
    return Promise.resolve();
  }

  resetZoom(): Promise<void> {
    this._setZoom(1);
    return Promise.resolve();
  }

  reload(): Promise<void> {
    this._requireWindow().webview?.executeJavascript("location.reload()");
    return Promise.resolve();
  }

  getFullscreenState() {
    return Promise.resolve({ fullScreen: this._requireWindow().isFullScreen() });
  }

  /** Publish a native fullscreen transition to the owning renderer. */
  private _notifyFullScreenChanged(fullScreen: boolean): void {
    this.events.publish("fullScreenChanged", { fullScreen });
  }

  /** Release listeners owned by this native window. */
  @preDestroy()
  async dispose(): Promise<void> {
    await this._fullScreenSubscription?.dispose();
    this._fullScreenSubscription = undefined;
    await this._windowState.dispose();
    this.events.dispose();
  }

  private _changeZoom(delta: number): void {
    this._setZoom(_clampZoom(this._requireWindow().getPageZoom() + delta));
  }

  private _setZoom(zoom: number): void {
    const window = this._requireWindow();
    window.setPageZoom(zoom);
    this._windowState.saveZoom(zoom);
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

@injectable()
class WindowContribution implements RpcContributionApi {
  constructor(
    @inject(WindowApplication)
    private readonly _application: WindowApplication
  ) {}

  registerRpc(rpc: RpcRegistry): void {
    rpc.registerServer(
      new WindowRpcServer(this._application, this._application.events)
    );
  }
}

/** Bind the Window application, RPC, and commands for one native window. */
export function nativeWindowContributionsModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(WindowStateController).toSelf().inSingletonScope();
    bind(WindowApplication).toSelf().inSingletonScope();
    bind(WindowContribution).toSelf().inSingletonScope();
    bind<RpcContributionApi>(RpcContribution).toService(WindowContribution);
  });
}
