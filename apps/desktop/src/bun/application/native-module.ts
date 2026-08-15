import type { SkillsManager } from "@llm-space/runtime/skills";
import { Utils, type BrowserWindow } from "electrobun/bun";
import { ContainerModule, type ResolutionContext } from "inversify";

import type { DesktopWindowContext } from "../../shared/agent-project";
import { isChineseLocale } from "../app/locales";
import type { WindowStateManager } from "../app/window-state";
import {
  CommandContribution,
  type CommandContribution as CommandContributionApi,
} from "../di/command-contribution";
import type { CommandRegistry, CommandSink } from "../di/command-registry";
import type { DesktopWindowScope } from "../di/process-container";
import {
  RpcContribution,
  type RpcContribution as RpcContributionApi,
} from "../di/rpc-contribution";
import type { RpcRegistry } from "../di/rpc-registry";
import { desktopToken, PROCESS_TOKENS, WINDOW_TOKENS } from "../di/tokens";
import {
  importFilesWithNativePicker,
  importTextFromClipboard,
} from "../import-files";
import { parseExternalUrl } from "../parse-external-url";
import { AppDirectoriesRpcServer } from "../rpc/app-directories-rpc-server";
import { NativeDialogsRpcServer } from "../rpc/native-dialogs-rpc-server";
import { NativeFilesRpcServer } from "../rpc/native-files-rpc-server";
import { WindowRpcServer } from "../rpc/window-rpc-server";

import {
  AppDirectoriesApplication,
  type AppDirectoriesApplicationApi,
  NativeDialogApplication,
  type NativeDialogsApplication,
  NativeFileApplication,
  type NativeFilesApplication,
  WindowApplication,
} from "./native-applications";

const DOCS_URL =
  "https://github.com/deer-flow/llm-space/blob/main/docs/index.md";
const DOCS_ZH_CN_URL = "https://my.feishu.cn/wiki/QnGGwGkoti8nwok2cEOc2oMvnrd";
const ISSUES_URL = "https://github.com/deer-flow/llm-space/issues";
const ZOOM_STEP = 0.1;

function _clampZoom(zoom: number): number {
  return Math.min(3, Math.max(0.3, zoom));
}

export const NATIVE_APPLICATION_TOKENS = {
  dialogs: desktopToken<NativeDialogsApplication>(
    "native",
    "dialogs-application"
  ),
  files: desktopToken<NativeFilesApplication>("native", "files-application"),
  appDirectories: desktopToken<AppDirectoriesApplicationApi>(
    "native",
    "app-directories-application"
  ),
  window: desktopToken<WindowApplication>("native", "window-application"),
} as const;

/** Register process-owned native services and window-owned shell state. */
export function nativeApplicationsModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind<NativeDialogsApplication>(NATIVE_APPLICATION_TOKENS.dialogs)
      .to(NativeDialogApplication)
      .inSingletonScope();
    bind<NativeFilesApplication>(NATIVE_APPLICATION_TOKENS.files)
      .toDynamicValue(
        (context: ResolutionContext) =>
          new NativeFileApplication(
            context.get<SkillsManager>(PROCESS_TOKENS.skillsManager)
          )
      )
      .inSingletonScope();
    bind<AppDirectoriesApplicationApi>(NATIVE_APPLICATION_TOKENS.appDirectories)
      .toDynamicValue(
        (context: ResolutionContext) =>
          new AppDirectoriesApplication(context.get(PROCESS_TOKENS.homePath))
      )
      .inSingletonScope();
  });
}

class NativeImportContribution
  implements CommandContributionApi, RpcContributionApi
{
  constructor(
    private readonly _dialogs: NativeDialogsApplication,
    private readonly _commandSink: CommandSink
  ) {}

  registerRpc(rpc: RpcRegistry): void {
    rpc.registerServer(new NativeDialogsRpcServer(this._dialogs));
  }

  registerCommands(commands: CommandRegistry): void {
    commands.registerCommand("playground.importFiles", {
      execute: () => {
        void importFilesWithNativePicker(
          (next) => this._commandSink.sendToWebview(next)
        );
      },
    });
    commands.registerCommand("playground.importFromClipboard", {
      execute: () =>
        importTextFromClipboard(
          (next) => this._commandSink.sendToWebview(next)
        ),
    });
  }
}

class NativeFilesContribution implements RpcContributionApi {
  constructor(private readonly _files: NativeFilesApplication) {}

  registerRpc(rpc: RpcRegistry): void {
    rpc.registerServer(new NativeFilesRpcServer(this._files));
  }
}

class AppDirectoriesContribution implements RpcContributionApi {
  constructor(
    private readonly _appDirectories: AppDirectoriesApplicationApi
  ) {}

  registerRpc(rpc: RpcRegistry): void {
    rpc.registerServer(new AppDirectoriesRpcServer(this._appDirectories));
  }
}

class WindowContribution implements CommandContributionApi, RpcContributionApi {
  constructor(
    private readonly _windowApplication: WindowApplication,
    private readonly _windowStates: WindowStateManager,
    private readonly _getWindow: () => BrowserWindow
  ) {}

  registerRpc(rpc: RpcRegistry): void {
    rpc.registerServer(
      new WindowRpcServer(
        this._windowApplication,
        this._windowApplication.events
      )
    );
  }

  registerCommands(commands: CommandRegistry): void {
    commands.registerCommand("window.toggleMaximized", {
      execute: () => this._windowApplication.toggleMaximized(),
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

  /** Apply a relative zoom step to the owning native window. */
  private _changeZoom(delta: number): void {
    this._setZoom(_clampZoom(this._getWindow().getPageZoom() + delta));
  }

  /** Persist the same absolute zoom applied to the native renderer. */
  private _setZoom(zoom: number): void {
    const window = this._getWindow();
    window.setPageZoom(zoom);
    this._windowStates.saveZoom(window, zoom);
  }
}

class ShellContribution implements CommandContributionApi {
  registerCommands(commands: CommandRegistry): void {
    commands.registerCommand("shell.openLink", {
      execute: (command) => {
        try {
          Utils.openExternal(parseExternalUrl(command.args.url).href);
        } catch {
          console.error("Blocked unsafe external URL.");
        }
      },
    });
    commands.registerCommand("shell.openDocument", {
      execute: () =>
        Utils.openExternal(isChineseLocale() ? DOCS_ZH_CN_URL : DOCS_URL),
    });
    commands.registerCommand("shell.reportBugs", {
      execute: () => Utils.openExternal(ISSUES_URL),
    });
  }
}

export interface NativeContributionsModuleInput {
  readonly getWindow: () => BrowserWindow;
  readonly commandSink: CommandSink;
}

/** Bind the native feature contribution and its per-window application state. */
export function nativeContributionsModule(
  scope: DesktopWindowScope,
  input: NativeContributionsModuleInput
): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind<WindowApplication>(NATIVE_APPLICATION_TOKENS.window)
      .toDynamicValue(
        (context) =>
          scope.own(
            new WindowApplication(
              input.getWindow,
              context.get<DesktopWindowContext>(WINDOW_TOKENS.context)
            )
          )
      )
      .inSingletonScope();
    bind(NativeImportContribution)
      .toDynamicValue(
        (context) =>
          new NativeImportContribution(
            context.get(NATIVE_APPLICATION_TOKENS.dialogs),
            input.commandSink
          )
      )
      .inSingletonScope();
    bind(NativeFilesContribution)
      .toDynamicValue(
        (context) =>
          new NativeFilesContribution(
            context.get(NATIVE_APPLICATION_TOKENS.files)
          )
      )
      .inSingletonScope();
    bind(AppDirectoriesContribution)
      .toDynamicValue(
        (context) =>
          new AppDirectoriesContribution(
            context.get(NATIVE_APPLICATION_TOKENS.appDirectories)
          )
      )
      .inSingletonScope();
    bind(WindowContribution)
      .toDynamicValue(
        (context) =>
          new WindowContribution(
            context.get(NATIVE_APPLICATION_TOKENS.window),
            context.get(PROCESS_TOKENS.windowStates),
            input.getWindow
          )
      )
      .inSingletonScope();
    bind(ShellContribution).toSelf().inSingletonScope();
    bind<CommandContributionApi>(CommandContribution).toService(
      NativeImportContribution
    );
    bind<RpcContributionApi>(RpcContribution).toService(
      NativeImportContribution
    );
    bind<RpcContributionApi>(RpcContribution).toService(
      NativeFilesContribution
    );
    bind<RpcContributionApi>(RpcContribution).toService(
      AppDirectoriesContribution
    );
    bind<CommandContributionApi>(CommandContribution).toService(
      WindowContribution
    );
    bind<RpcContributionApi>(RpcContribution).toService(WindowContribution);
    bind<CommandContributionApi>(CommandContribution).toService(
      ShellContribution
    );
  });
}
