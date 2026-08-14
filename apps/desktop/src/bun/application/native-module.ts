import { mkdirSync } from "node:fs";
import path from "node:path";

import type { SkillsManager } from "@llm-space/runtime/skills";
import { writeClipboardFilePaths } from "clip-filepaths";
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
import {
  AppDirectoriesRpcServer,
  NativeDialogsRpcServer,
  NativeFilesRpcServer,
  WindowRpcServer,
} from "../rpc/native-rpc-servers";

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

class NativeContribution implements CommandContributionApi, RpcContributionApi {
  constructor(
    private readonly _dialogs: NativeDialogsApplication,
    private readonly _files: NativeFilesApplication,
    private readonly _appDirectories: AppDirectoriesApplicationApi,
    private readonly _windowApplication: WindowApplication,
    private readonly _windowStates: WindowStateManager,
    private readonly _homePath: string,
    private readonly _getWindow: () => BrowserWindow,
    private readonly _commandSink: CommandSink
  ) {}

  /** Register native dialogs, files, directories, and window RPC namespaces. */
  registerRpc(rpc: RpcRegistry): void {
    rpc.registerServer(new NativeDialogsRpcServer(this._dialogs));
    rpc.registerServer(new NativeFilesRpcServer(this._files));
    rpc.registerServer(new AppDirectoriesRpcServer(this._appDirectories));
    rpc.registerServer(
      new WindowRpcServer(
        this._windowApplication,
        this._windowApplication.events
      )
    );
  }

  /** Register native import, window, link, and filesystem commands. */
  registerCommands(commands: CommandRegistry): void {
    commands.registerCommand("workspace.importFiles", {
      execute: (command) => {
        void importFilesWithNativePicker(
          (next) => this._commandSink.sendToWebview(next),
          command.args.parent
        );
      },
    });
    commands.registerCommand("workspace.importFromClipboard", {
      execute: (command) =>
        importTextFromClipboard(
          (next) => this._commandSink.sendToWebview(next),
          command.args.parent
        ),
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
    commands.registerCommand("workspace.copyFile", {
      execute: (command) => {
        try {
          writeClipboardFilePaths([command.args.path]);
        } catch (error) {
          console.error("Failed to copy to clipboard:", error);
        }
      },
    });
    commands.registerCommand("shell.openWorkspaceFolder", {
      execute: () => {
        const workspacePath = path.join(this._homePath, "workspace");
        mkdirSync(workspacePath, { recursive: true });
        Utils.openPath(workspacePath);
      },
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
        () =>
          new WindowApplication(
            input.getWindow,
            scope.get<DesktopWindowContext>(WINDOW_TOKENS.context)
          )
      )
      .inSingletonScope();
    bind(NativeContribution)
      .toDynamicValue(
        () =>
          new NativeContribution(
            scope.get(NATIVE_APPLICATION_TOKENS.dialogs),
            scope.get(NATIVE_APPLICATION_TOKENS.files),
            scope.get(NATIVE_APPLICATION_TOKENS.appDirectories),
            scope.get(NATIVE_APPLICATION_TOKENS.window),
            scope.get(PROCESS_TOKENS.windowStates),
            scope.get(PROCESS_TOKENS.homePath),
            input.getWindow,
            input.commandSink
          )
      )
      .inSingletonScope();
    bind<CommandContributionApi>(CommandContribution).toService(
      NativeContribution
    );
    bind<RpcContributionApi>(RpcContribution).toService(NativeContribution);
  });
}
