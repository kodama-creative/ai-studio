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
import type { WindowStateManager } from "../app/window-state";
import {
  CommandContribution,
  type CommandContribution as CommandContributionApi,
} from "../di/command-contribution";
import type { CommandRegistry } from "../di/command-registry";
import type { DesktopWindowScope } from "../di/process-container";
import {
  RpcContribution,
  type RpcContribution as RpcContributionApi,
} from "../di/rpc-contribution";
import type { RpcRegistry } from "../di/rpc-registry";
import { desktopToken, PROCESS_TOKENS, WINDOW_TOKENS } from "../di/tokens";

const ZOOM_STEP = 0.1;

function _clampZoom(zoom: number): number {
  return Math.min(3, Math.max(0.3, zoom));
}

export const WINDOW_APPLICATION =
  desktopToken<WindowApplication>("window", "application");

export class WindowApplication implements WindowRequests, Disposable {
  readonly events = new EventHub<WindowEvents>();

  constructor(
    private readonly _window: () => BrowserWindow,
    private readonly _context: DesktopWindowContext
  ) {}

  getContext() {
    return Promise.resolve(this._context);
  }

  toggleMaximized() {
    const window = this._window();
    if (window.isMaximized()) window.unmaximize();
    else window.maximize();
  }

  getFullscreenState() {
    return Promise.resolve({ fullScreen: this._window().isFullScreen() });
  }

  /** Publish a native fullscreen transition to the owning renderer. */
  notifyFullScreenChanged(fullScreen: boolean): void {
    this.events.publish("fullScreenChanged", { fullScreen });
  }

  /** Release listeners owned by this native window. */
  dispose(): void {
    this.events.dispose();
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
  constructor(
    private readonly _application: WindowApplication,
    private readonly _windowStates: WindowStateManager,
    private readonly _getWindow: () => BrowserWindow
  ) {}

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
      execute: () => this._changeZoom(ZOOM_STEP),
    });
    commands.registerCommand("window.zoomOut", {
      execute: () => this._changeZoom(-ZOOM_STEP),
    });
    commands.registerCommand("window.resetZoom", {
      execute: () => this._setZoom(1),
    });
    commands.registerCommand("window.reload", {
      execute: () =>
        this._getWindow().webview?.executeJavascript("location.reload()"),
    });
  }

  private _changeZoom(delta: number): void {
    this._setZoom(_clampZoom(this._getWindow().getPageZoom() + delta));
  }

  private _setZoom(zoom: number): void {
    const window = this._getWindow();
    window.setPageZoom(zoom);
    this._windowStates.saveZoom(window, zoom);
  }
}

/** Bind the Window application, RPC, and commands for one native window. */
export function nativeWindowContributionsModule(
  scope: DesktopWindowScope,
  getWindow: () => BrowserWindow
): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind<WindowApplication>(WINDOW_APPLICATION)
      .toDynamicValue(
        (context) =>
          scope.own(
            new WindowApplication(
              getWindow,
              context.get(WINDOW_TOKENS.context)
            )
          )
      )
      .inSingletonScope();
    bind(WindowContribution)
      .toDynamicValue(
        (context) =>
          new WindowContribution(
            context.get(WINDOW_APPLICATION),
            context.get(PROCESS_TOKENS.windowStates),
            getWindow
          )
      )
      .inSingletonScope();
    bind<CommandContributionApi>(CommandContribution).toService(
      WindowContribution
    );
    bind<RpcContributionApi>(RpcContribution).toService(WindowContribution);
  });
}
