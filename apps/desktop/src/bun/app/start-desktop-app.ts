import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { getLlmSpaceHomePath } from "@llm-space/core/server";
import { GistThreadReader, GistThreadWriter } from "@llm-space/core/storage";
import { createPiRunExecutor } from "@llm-space/engine-pi";
import { PluginManager } from "@llm-space/runtime/plugins";
import Electrobun, {
  app,
  type BrowserWindow,
  type ElectrobunEvent,
  Utils,
  PATHS,
} from "electrobun/bun";

import packageJson from "../../../package.json";
import type { Command } from "../../shared/commands";
import { resolveDeepLinkScheme } from "../../shared/deep-link-scheme";
import { Analytics } from "../analytics";
import { GitHubAuthManager } from "../auth";
import { executeCommandInBun } from "../commands";
import { createDeepLinkHandler, type DeepLinkHandler } from "../deep-link";
import { activateWindowForDeepLink } from "../deep-link/activate-window";
import { setDeepLinkHandler } from "../deep-link/launch";
import { moveToTrash, openPath, revealInFileManager } from "../fs";
import { DesktopHost } from "../host/desktop-host";
import { McpManager } from "../mcp";
import { createConfiguredArkImageGenerator, ModelManager } from "../models";
import { NetworkSettingsManager } from "../network";
import { createPlaygroundHost } from "../playgrounds/playground-host";
import {
  PluginCommandExecutionController,
  type PluginCommandReportInput,
} from "../plugins/plugin-command-execution-controller";
import { createProjectStudioHost } from "../projects/project-studio-host";
import { ProjectWindowManager } from "../projects/project-window-manager";
import {
  FileAgentProjectCatalogStore,
  FileProjectWindowStateStore,
  ProjectWindowStateFile,
} from "../projects/project-window-state";
import {
  RemoteServerManager,
  registerConfiguredRemoteRuntime,
} from "../remote";
import {
  createMainWindowRPC,
  type MainWindowRPC,
  type MainWindowRPCController,
} from "../rpc";
import { LocalRuntimeClient, RuntimeRouter } from "../runtime";
import { SearchSettingsManager } from "../search";
import { getManagedSkillsDir, SkillsManager } from "../skills";
import { createLocalFileSystem } from "../storage";
import { StreamThreadController } from "../streaming";
import { createBuiltInToolsModule } from "../tools/built-in";
import { TraceManager } from "../traces";
import { UpdaterService } from "../updates";

import { createShutdownCoordinator } from "./shutdown-coordinator";
import { createAgentProjectWindow, createMainWindow } from "./window";
import { WindowStateManager } from "./window-state";

export interface DesktopAppRuntime {
  stop(): Promise<void>;
}

/** Build and start the production Bun object graph. */
export async function startDesktopApp(): Promise<DesktopAppRuntime> {
  const homePath = getLlmSpaceHomePath();
  const workspacePath = path.join(homePath, "workspace");
  const analytics = new Analytics();
  // Apply the configured proxy to `process.env` before anything spawns a
  // subprocess (MCP) or makes a request, so egress is routed from the start.
  const networkSettings = new NetworkSettingsManager();
  const mcpManager = new McpManager();
  const modelManager = new ModelManager();
  const generateImage = createConfiguredArkImageGenerator({
    modelManager,
    env: process.env,
  });
  const searchSettings = new SearchSettingsManager();
  const skillsManager = new SkillsManager({
    managedSkillsDir: getManagedSkillsDir(),
  });
  let mainWindow: BrowserWindow | null = null;
  let rpc: MainWindowRPC | null = null;
  let deepLink: DeepLinkHandler | null = null;
  const getRpc = (): MainWindowRPC => {
    if (!rpc) throw new Error("Main window RPC is not ready.");
    return rpc;
  };
  const getMainWindow = (): BrowserWindow => {
    if (!mainWindow) throw new Error("Main window is not ready.");
    return mainWindow;
  };
  const githubAuth = new GitHubAuthManager({
    onChange: (state) => getRpc().send.githubAuthChanged(state),
  });
  const localFs = createLocalFileSystem(homePath);
  // Write-side gist connector for the "Share thread" flow. Reuses the signed-in
  // GitHub token (the `gist` scope); creates secret gists readable by URL.
  const gistWriter = new GistThreadWriter({
    getToken: () => githubAuth.getAccessToken(),
  });
  const gistReader = new GistThreadReader({
    getToken: () => githubAuth.getAccessToken(),
  });
  const packagedRunnerPath = path.join(
    PATHS.RESOURCES_FOLDER,
    "app",
    "plugin-runner.ts"
  );
  const sourceRunnerPath = path.resolve(
    import.meta.dir,
    "../../../../../packages/runtime/src/plugins/plugin-runner.ts"
  );
  let executePluginHostCommand = (type: string): Promise<unknown> =>
    Promise.reject(new Error(`Command execution is not ready: ${type}`));
  let reportPluginCommand = (
    input: PluginCommandReportInput
  ): Promise<unknown> =>
    Promise.reject(
      new Error(`Command reporting is not ready: ${input.commandId}`)
    );
  const pluginManager = await PluginManager.create({
    homePath,
    appVersion: packageJson.version,
    runnerPath: existsSync(packagedRunnerPath)
      ? packagedRunnerPath
      : sourceRunnerPath,
    skillsManager,
    mcpManager,
    modelManager,
    onChanged: () => rpc?.send.pluginsChanged({}),
    handleHostRequest: async (method, rawParams) => {
      const params = (rawParams ?? {}) as Record<string, unknown>;
      if (method === "notify") {
        Utils.showNotification({
          title: "LLM Space",
          body: _stringParam(params, "message"),
        });
        return null;
      }
      if (method === "openLink") {
        Utils.openExternal(_stringParam(params, "url"));
        return null;
      }
      if (method === "pickFile") {
        const selected = await Utils.openFileDialog({
          startingFolder: "~/",
          canChooseFiles: true,
          canChooseDirectory: false,
          allowsMultipleSelection: false,
        });
        return selected[0] ?? null;
      }
      if (method === "readWorkspaceFile") {
        return readFile(localFs.realpath(_stringParam(params, "path")), "utf8");
      }
      if (method === "writeWorkspaceFile") {
        const filePath = localFs.realpath(_stringParam(params, "path"));
        await mkdir(path.dirname(filePath), { recursive: true });
        await writeFile(filePath, _stringParam(params, "content"), "utf8");
        return null;
      }
      if (method === "executeHostCommand") {
        return executePluginHostCommand(_stringParam(params, "type"));
      }
      if (method === "report") {
        return reportPluginCommand({
          executionId: _stringParam(params, "executionId"),
          commandId: _stringParam(params, "commandId"),
          report: _commandReportParam(params),
        });
      }
      throw new Error(`Unsupported plugin host operation: ${method}`);
    },
  });
  const pluginCommandExecutions = new PluginCommandExecutionController({
    execute: (commandId, context, args, executionId) =>
      pluginManager.commands.executeWithContext(
        commandId,
        context,
        args,
        executionId
      ),
    send: (event) => getRpc().send.pluginCommandExecutionChanged(event),
  });
  reportPluginCommand = (input) => {
    pluginCommandExecutions.report(input);
    return Promise.resolve(null);
  };
  pluginManager.threadStorages.registerBuiltin({
    id: "builtin:github-gist",
    displayName: "GitHub Gist",
    description: "Read and write a thread using GitHub Gist.",
    reader: gistReader,
    writer: gistWriter,
  });
  const traceManager = new TraceManager({ homePath });
  const streaming = new StreamThreadController(modelManager, analytics);
  const host = new DesktopHost({
    modules: [
      createBuiltInToolsModule({
        env: process.env,
        findSkill: skillsManager.findSkill.bind(skillsManager),
        generateImage,
        getSearchSettings: searchSettings.get.bind(searchSettings),
        workspaceRoot: workspacePath,
        openPath,
        revealPath: revealInFileManager,
      }),
    ],
  });
  await host.start();
  const localRuntime = new LocalRuntimeClient({
    localFs,
    mcpManager,
    modelManager,
    networkSettings,
    searchSettings,
    skillsManager,
    streaming,
    tools: host.tools,
    traceManager,
    rmPath: async (workspacePath) => {
      const abs = localFs.realpath(workspacePath);
      if (abs === localFs.realpath("")) {
        throw new Error("Cannot delete the workspace root.");
      }
      await moveToTrash(abs);
    },
  });
  const runtimeRouter = new RuntimeRouter(localRuntime);
  const playgroundHost = createPlaygroundHost({
    homePath,
    runExecutor: createPiRunExecutor({
      models: await modelManager.getAvailableModels(),
    }),
    runtime: localRuntime,
    pluginManager,
  });
  const remoteServerManager = new RemoteServerManager(runtimeRouter);
  const remoteRuntime = await registerConfiguredRemoteRuntime({
    env: process.env,
    runtimeRouter,
  });

  const updater = new UpdaterService((message) =>
    getRpc().send.updateStatusChanged(message)
  );
  const windowStates = new WindowStateManager();
  const windowRpcs = new Map<number, MainWindowRPC>();
  const pickAgentProject = async (): Promise<void> => {
    const selected = await Utils.openFileDialog({
      startingFolder: "~/",
      canChooseFiles: false,
      canChooseDirectory: true,
      allowsMultipleSelection: false,
    });
    const selectedPath = selected.map((value) => value.trim()).find(Boolean);
    if (selectedPath === undefined) return;
    try {
      await projectWindows.openProject(selectedPath);
    } catch (error) {
      console.error("Failed to open agent project:", error);
      Utils.showNotification({
        title: "Unable to Open Agent Project",
        body: _errorMessage(error),
      });
    }
  };
  const executeCommand = (command: Command, window: BrowserWindow): void => {
    const targetRpc = windowRpcs.get(window.id) ?? getRpc();
    executeCommandInBun(command, window, {
      githubAuth,
      openAgentProject: pickAgentProject,
      openExternal: Utils.openExternal,
      sendToWebview: (nextCommand) =>
        targetRpc.send.executeCommand(nextCommand),
      saveWindowZoom: (targetWindow, zoom) =>
        windowStates.saveZoom(targetWindow, zoom),
      updater,
      workspacePath,
    });
  };
  const createWindowRpc = (
    getWindow: () => BrowserWindow,
    projectStudioHost?: Awaited<ReturnType<typeof createProjectStudioHost>>
  ): MainWindowRPCController =>
    createMainWindowRPC({
      analytics,
      executeCommand: (command) => executeCommand(command, getWindow()),
      onCancelSharedImport: () => deepLink?.cancel(),
      githubAuth,
      getMainWindow: getWindow,
      gistWriter,
      homePath,
      runtimeRouter,
      remoteServerManager,
      skillsManager,
      updater,
      pluginManager,
      pluginCommandExecutions,
      playgroundHost,
      listAgentProjects: async () =>
        (await projectWindows.listProjects()).map((project) => ({
          id: project.id,
          name: project.name,
          rootPath: project.rootPath,
        })),
      openAgentProject: (rootPath) => projectWindows.openProject(rootPath),
      pickAgentProject,
      ...(projectStudioHost === undefined
        ? {}
        : {
            projectStudioHost,
            windowContext: {
              kind: "agentProject" as const,
              project: projectStudioHost.project,
            },
          }),
    });
  const projectWindows = new ProjectWindowManager({
    state: new FileProjectWindowStateStore(homePath),
    catalog: new FileAgentProjectCatalogStore(homePath),
    windows: {
      async create(project) {
        const projectStudioHost = await createProjectStudioHost({
          project,
          runExecutor: createPiRunExecutor({
            models: await modelManager.getAvailableModels(),
          }),
        });
        let projectRpcController: MainWindowRPCController | undefined;
        try {
          const projectWindowRef: { current?: BrowserWindow } = {};
          const getProjectWindow = (): BrowserWindow => {
            if (projectWindowRef.current === undefined) {
              throw new Error("Agent project window is not ready.");
            }
            return projectWindowRef.current;
          };
          const controller = createWindowRpc(
            getProjectWindow,
            projectStudioHost
          );
          projectRpcController = controller;
          const stateStore = await ProjectWindowStateFile.load(
            homePath,
            project.id
          );
          const projectWindow = await createAgentProjectWindow({
            rpc: controller.rpc,
            project: projectStudioHost.project,
            stateStore,
            windowStates,
          });
          projectWindowRef.current = projectWindow;
          windowRpcs.set(projectWindow.id, controller.rpc);
          const closed = new Set<() => void>();
          let cleanupPromise: Promise<void> | undefined;
          const cleanup = (): Promise<void> => {
            cleanupPromise ??= (async () => {
              windowRpcs.delete(projectWindow.id);
              controller.dispose();
              try {
                await projectStudioHost.close();
              } finally {
                for (const listener of closed) listener();
              }
            })();
            return cleanupPromise;
          };
          projectWindow.on("close", () => {
            void cleanup().catch((error) => {
              console.error("Failed to close agent project host:", error);
            });
          });
          return {
            activate: () => projectWindow.activate(),
            close: async () => {
              projectWindow.close();
              await cleanup();
            },
            onClosed: (listener) => closed.add(listener),
          };
        } catch (error) {
          projectRpcController?.dispose();
          try {
            await projectStudioHost.close();
          } catch (cleanupError) {
            console.error(
              "Failed to clean up agent project host after window creation failed:",
              cleanupError
            );
          }
          throw error;
        }
      },
    },
  });
  executePluginHostCommand = (type) => {
    if (type !== "openSettings" && type !== "refreshTree") {
      throw new Error(`Plugin host command is not allowed: ${type}`);
    }
    executeCommand({ type, args: {} }, getMainWindow());
    return Promise.resolve(null);
  };

  let mainRpcController: MainWindowRPCController | undefined;
  let stopPromise: Promise<void> | null = null;
  const runtime: DesktopAppRuntime = {
    stop() {
      stopPromise ??= _stopDesktopApp([
        ["agent project windows", () => projectWindows.closeAll()],
        ["main window RPC", () => mainRpcController?.dispose()],
        ["playground host", () => playgroundHost.close()],
        ["window state", () => windowStates.flush()],
        ["updater", () => updater.stop()],
        ["remote runtime", () => remoteRuntime?.stop()],
        ["remote servers", () => remoteServerManager.shutdown()],
        ["streaming", () => streaming.shutdown()],
        ["desktop host", () => host.stop()],
        ["MCP manager", () => mcpManager.shutdown()],
        ["plugin manager", () => pluginManager.shutdown()],
        ["GitHub auth", () => githubAuth.cancelSignIn()],
        ["analytics", () => analytics.shutdown()],
      ]);
      return stopPromise;
    },
  };

  try {
    mainRpcController = createWindowRpc(getMainWindow);
    rpc = mainRpcController.rpc;
    remoteServerManager.setStatusListener((payload) =>
      getRpc().send.remoteServerStatusChanged(payload)
    );
    mainWindow = await createMainWindow({
      rpc,
      executeCommand,
      windowStates,
    });
    windowRpcs.set(mainWindow.id, rpc);

    // The window + rpc are ready — wire the importer and flush any deep links
    // buffered at process entry during a cold-start launch (see deep-link/launch).
    deepLink = createDeepLinkHandler({
      localFs,
      githubAuth,
      threadStorages: pluginManager.threadStorages,
      getRpc,
    });
    const deepLinkScheme = resolveDeepLinkScheme(
      process.env.LLM_SPACE_DEEP_LINK_SCHEME
    );
    setDeepLinkHandler((url) => {
      activateWindowForDeepLink(getMainWindow(), url, deepLinkScheme);
      void deepLink?.handle(url);
    });

    analytics.capture("app_opened", { isFirstOpen: analytics.isFirstRun });
    void updater.start();
    await projectWindows.restoreProjects();

    const handleBeforeQuit = createShutdownCoordinator({
      quit: () => app.quit(),
      stop: () => runtime.stop(),
    });
    Electrobun.events.on(
      "before-quit",
      (event: ElectrobunEvent<{}, { allow: boolean }>) =>
        handleBeforeQuit(event)
    );

    return runtime;
  } catch (error) {
    await runtime.stop();
    throw error;
  }
}

function _stringParam(params: Record<string, unknown>, key: string): string {
  const value = params[key];
  if (typeof value !== "string") {
    throw new Error(`Plugin host parameter must be a string: ${key}`);
  }
  return value;
}

function _errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function _commandReportParam(
  params: Record<string, unknown>
): PluginCommandReportInput["report"] {
  const report = params.report;
  if (!report || typeof report !== "object" || Array.isArray(report)) {
    throw new Error("Plugin Command report must be an object.");
  }
  return report as PluginCommandReportInput["report"];
}

async function _stopDesktopApp(
  cleanups: readonly [name: string, cleanup: () => Promise<void> | void][]
): Promise<void> {
  for (const [name, cleanup] of cleanups) {
    try {
      await cleanup();
    } catch (error) {
      console.error(`Failed to stop ${name}:`, error);
    }
  }
}
