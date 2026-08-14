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
  COMMAND_HANDLER_CONTRIBUTION,
  type CommandHandlerContribution,
} from "../di/command-contribution";
import {
  RPC_SERVER_CONTRIBUTION,
  type RpcServerContribution,
} from "../di/rpc-contribution";
import {
  desktopToken,
  PROCESS_TOKENS,
  WINDOW_TOKENS,
} from "../di/tokens";
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
  dialogs: desktopToken<NativeDialogsApplication>("native", "dialogs-application"),
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
    const contribute = (
      id: RpcServerContribution["id"],
      create: RpcServerContribution["create"]
    ) =>
      bind<RpcServerContribution>(RPC_SERVER_CONTRIBUTION).toConstantValue({
        id,
        windows: ["main", "project"],
        create,
      });
    contribute(
      "native.dialogs.rpc",
      (scope) =>
        new NativeDialogsRpcServer(scope.get(NATIVE_APPLICATION_TOKENS.dialogs))
    );
    contribute(
      "native.files.rpc",
      (scope) =>
        new NativeFilesRpcServer(scope.get(NATIVE_APPLICATION_TOKENS.files))
    );
    contribute(
      "native.app-directories.rpc",
      (scope) =>
        new AppDirectoriesRpcServer(
          scope.get(NATIVE_APPLICATION_TOKENS.appDirectories)
        )
    );
    contribute("native.window.rpc", (scope) => {
      const application = new WindowApplication(
        () => scope.get<BrowserWindow>(WINDOW_TOKENS.browserWindow),
        scope.get<DesktopWindowContext>(WINDOW_TOKENS.context)
      );
      scope.bindConstant(NATIVE_APPLICATION_TOKENS.window, application);
      return new WindowRpcServer(application, application.events);
    });

    const contributeCommand = (value: CommandHandlerContribution) =>
      bind<CommandHandlerContribution>(
        COMMAND_HANDLER_CONTRIBUTION
      ).toConstantValue(value);
    const windows = ["main", "project"] as const;
    contributeCommand({
      id: "workspace.import.commands",
      windows,
      create: (_scope, context) => ({
        commands: ["workspace.importFiles", "workspace.importFromClipboard"],
        execute(command) {
          if (command.type === "workspace.importFiles") {
            void importFilesWithNativePicker(
              context.sendToWebview,
              command.args.parent
            );
          } else if (command.type === "workspace.importFromClipboard") {
            importTextFromClipboard(context.sendToWebview, command.args.parent);
          }
        },
      }),
    });
    contributeCommand({
      id: "window.commands",
      windows,
      create: (scope, context) => {
        const windowStates = scope.get<WindowStateManager>(
          PROCESS_TOKENS.windowStates
        );
        return {
          commands: [
            "window.zoomIn",
            "window.zoomOut",
            "window.resetZoom",
            "window.reload",
          ],
          execute(command) {
            const window = context.window();
            if (command.type === "window.reload") {
              window.webview?.executeJavascript("location.reload()");
              return;
            }
            const zoom =
              command.type === "window.resetZoom"
                ? 1
                : _clampZoom(
                    window.getPageZoom() +
                      (command.type === "window.zoomIn" ? ZOOM_STEP : -ZOOM_STEP)
                  );
            window.setPageZoom(zoom);
            windowStates.saveZoom(window, zoom);
          },
        };
      },
    });
    contributeCommand({
      id: "shell.links.commands",
      windows,
      create: () => ({
        commands: ["shell.openLink", "shell.openDocument", "shell.reportBugs"],
        execute(command) {
          if (command.type === "shell.openLink") {
            try {
              Utils.openExternal(parseExternalUrl(command.args.url).href);
            } catch {
              console.error("Blocked unsafe external URL.");
            }
          } else if (command.type === "shell.openDocument") {
            Utils.openExternal(isChineseLocale() ? DOCS_ZH_CN_URL : DOCS_URL);
          } else if (command.type === "shell.reportBugs") {
            Utils.openExternal(ISSUES_URL);
          }
        },
      }),
    });
    contributeCommand({
      id: "workspace.native-files.commands",
      windows,
      create: (scope) => {
        const homePath = scope.get<string>(PROCESS_TOKENS.homePath);
        return {
          commands: ["workspace.copyFile", "shell.openWorkspaceFolder"],
          execute(command) {
            if (command.type === "workspace.copyFile") {
              try {
                writeClipboardFilePaths([command.args.path]);
              } catch (error) {
                console.error("Failed to copy to clipboard:", error);
              }
              return;
            }
            const workspacePath = path.join(homePath, "workspace");
            mkdirSync(workspacePath, { recursive: true });
            Utils.openPath(workspacePath);
          },
        };
      },
    });
  });
}
