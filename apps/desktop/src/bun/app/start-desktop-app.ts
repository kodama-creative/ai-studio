import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { getLlmSpaceHomePath } from "@llm-space/core/server";
import { GistThreadReader, GistThreadWriter } from "@llm-space/core/storage";
import { createPiRunExecutor } from "@llm-space/engine-pi";
import { PluginManager } from "@llm-space/runtime/plugins";
import { createStudio, type Studio } from "@llm-space/studio/server";
import Electrobun, {
  app,
  type BrowserWindow,
  type ElectrobunEvent,
  Utils,
  PATHS,
} from "electrobun/bun";

import packageJson from "../../../package.json";
import type {
  AgentProjectView,
  DesktopWindowContext,
} from "../../shared/agent-project";
import type { Command } from "../../shared/commands";
import { resolveDeepLinkScheme } from "../../shared/deep-link-scheme";
import { Analytics } from "../analytics";
import { GitHubAuthManager } from "../auth";
import { executeCommandInBun } from "../commands";
import {
  createDeepLinkHandler,
  isStudioOpenDeepLink,
  type DeepLinkHandler,
} from "../deep-link";
import { activateWindowForDeepLink } from "../deep-link/activate-window";
import {
  getPendingDeepLinks,
  setDeepLinkHandler,
} from "../deep-link/launch";
import {
  mainWindowModule,
  processModule,
  projectWindowModule,
  windowModule,
} from "../di/modules";
import { createDesktopProcessContainer } from "../di/process-container";
import {
  PROCESS_TOKENS,
  PROJECT_WINDOW_TOKENS,
  WINDOW_TOKENS,
} from "../di/tokens";
import { attachWindowScope } from "../di/window-scope";
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
import { ProjectSandbox } from "../projects/project-sandbox";
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

import { MainWindowManager } from "./main-window-manager";
import { registerMenuActions } from "./menu";
import { createShutdownCoordinator } from "./shutdown-coordinator";
import { createAgentProjectWindow, createMainWindow } from "./window";
import { WindowStateManager } from "./window-state";

export interface DesktopAppRuntime {
  stop(): Promise<void>;
}

interface DesktopMainWindowHandle {
  readonly window: BrowserWindow;
  readonly rpc: MainWindowRPC;
  activate(): void;
}

/** Build and start the production Bun object graph. */
export async function startDesktopApp(): Promise<DesktopAppRuntime> {
  const processContainer = createDesktopProcessContainer();
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
  let deepLink: DeepLinkHandler | null = null;
  let mainWindows: MainWindowManager<DesktopMainWindowHandle> | undefined;
  const getRpc = (): MainWindowRPC => {
    const main = mainWindows?.current();
    if (main === undefined) throw new Error("Main window RPC is not ready.");
    return main.rpc;
  };
  const githubAuth = new GitHubAuthManager({
    onChange: (state) =>
      mainWindows?.current()?.rpc.send.githubAuthChanged(state),
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
    onChanged: () => mainWindows?.current()?.rpc.send.pluginsChanged({}),
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
    send: (event) =>
      mainWindows?.current()?.rpc.send.pluginCommandExecutionChanged(event),
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
      models: () => modelManager.getAvailableModels(),
      resolveConnection: ({ providerId }) =>
        modelManager.resolveConnection({ providerId }),
    }),
    runtime: localRuntime,
  });
  const remoteServerManager = new RemoteServerManager(runtimeRouter);
  const remoteRuntime = await registerConfiguredRemoteRuntime({
    env: process.env,
    runtimeRouter,
  });

  const updater = new UpdaterService((message) =>
    mainWindows?.current()?.rpc.send.updateStatusChanged(message)
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
    const targetRpc = windowRpcs.get(window.id);
    if (targetRpc === undefined) {
      throw new Error(`Window RPC is unavailable for window ${window.id}.`);
    }
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
    windowContext: DesktopWindowContext,
    projectStudio?: Studio
  ): MainWindowRPCController =>
    createMainWindowRPC({
      analytics: processContainer.get(PROCESS_TOKENS.analytics),
      executeCommand: (command) => executeCommand(command, getWindow()),
      onCancelSharedImport: () => deepLink?.cancel(),
      githubAuth: processContainer.get(PROCESS_TOKENS.githubAuth),
      getMainWindow: getWindow,
      gistWriter: processContainer.get(PROCESS_TOKENS.gistWriter),
      homePath: processContainer.get(PROCESS_TOKENS.homePath),
      runtimeRouter: processContainer.get(PROCESS_TOKENS.runtimeRouter),
      remoteServerManager: processContainer.get(
        PROCESS_TOKENS.remoteServerManager
      ),
      skillsManager: processContainer.get(PROCESS_TOKENS.skillsManager),
      updater: processContainer.get(PROCESS_TOKENS.updater),
      pluginManager: processContainer.get(PROCESS_TOKENS.pluginManager),
      pluginCommandExecutions: processContainer.get(
        PROCESS_TOKENS.pluginCommandExecutions
      ),
      playgroundHost: processContainer.get(PROCESS_TOKENS.playgroundHost),
      windowContext,
      listAgentProjects: async () =>
        (await projectWindows.listProjects()).map((project) => ({
          id: project.id,
          name: project.name,
          rootPath: project.rootPath,
        })),
      openAgentProject: (rootPath) => projectWindows.openProject(rootPath),
      pickAgentProject,
      ...(projectStudio === undefined
        ? {}
        : { projectStudio }),
    });
  const projectWindows = new ProjectWindowManager({
    state: new FileProjectWindowStateStore(homePath),
    catalog: new FileAgentProjectCatalogStore(homePath),
    windows: {
      async create(project) {
        const scope = processContainer.createWindowScope(
          `project:${project.id}`
        );
        try {
          const projectStudio = await createStudio({
            projectRoot: project.rootPath,
            dataRoot: project.studioStateRoot,
            models: () => modelManager.getAvailableModels(),
            resolveConnection: ({ providerId }) =>
              modelManager.resolveConnection({ providerId }),
            runtimeServices: { sandbox: new ProjectSandbox(project.rootPath) },
          });
          const projectView: AgentProjectView = {
            id: project.id,
            name: project.name,
            rootPath: project.rootPath,
            agentRoot: project.agentRoot,
            agentId: projectStudio.agent.agentId,
            generationId: projectStudio.agent.generationId,
          };
          scope.load(projectWindowModule({
            project: projectView,
            studio: projectStudio,
          }));
          const closed = new Set<() => void>();
          scope.onDisposed(() => closed.forEach((listener) => listener()));
          scope.onDispose(() => projectStudio.close());
          const projectWindowRef: { current?: BrowserWindow } = {};
          const getProjectWindow = (): BrowserWindow => {
            if (projectWindowRef.current === undefined) {
              throw new Error("Agent project window is not ready.");
            }
            return projectWindowRef.current;
          };
          const controller = createWindowRpc(
            getProjectWindow,
            scope.get(WINDOW_TOKENS.context),
            scope.get(PROJECT_WINDOW_TOKENS.studio)
          );
          scope.onDispose(() => controller.dispose());
          const stateStore = await ProjectWindowStateFile.load(
            homePath,
            project.id
          );
          const projectWindow = await createAgentProjectWindow({
            rpc: controller.rpc,
            project: scope.get(PROJECT_WINDOW_TOKENS.project),
            stateStore,
            windowStates,
          });
          projectWindowRef.current = projectWindow;
          scope.load(
            windowModule({ window: projectWindow, rpcController: controller })
          );
          attachWindowScope(scope, windowRpcs);
          return {
            activate: () => projectWindow.activate(),
            close: () => scope.dispose(),
            onClosed: (listener) => closed.add(listener),
          };
        } catch (error) {
          try {
            await scope.dispose();
          } catch (cleanupError) {
            console.error(
              "Failed to dispose Agent Project scope after creation failed:",
              cleanupError
            );
          }
          throw error;
        }
      },
    },
  });
  // DI resolution remains confined to this composition root; feature classes
  // still receive ordinary constructor arguments instead of the Container.
  processContainer.load(
    processModule({
      analytics,
      desktopHost: host,
      githubAuth,
      gistWriter,
      homePath,
      mcpManager,
      modelManager,
      networkSettings,
      playgroundHost,
      pluginCommandExecutions,
      pluginManager,
      projectWindows,
      remoteServerManager,
      runtimeRouter,
      searchSettings,
      skillsManager,
      streaming,
      traceManager,
      updater,
      windowStates,
    })
  );
  processContainer.onDispose(() =>
    _stopDesktopApp([
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
    ])
  );
  executePluginHostCommand = async (type) => {
    if (type !== "openSettings" && type !== "refreshTree") {
      throw new Error(`Plugin host command is not allowed: ${type}`);
    }
    const main = await _requireMainWindows(mainWindows).open();
    executeCommand({ type, args: {} }, main.window);
    return null;
  };

  let stopPromise: Promise<void> | null = null;
  const runtime: DesktopAppRuntime = {
    stop() {
      stopPromise ??= _stopDesktopApp([
        ["agent project windows", () => projectWindows.closeAll()],
        ["desktop process scope", () => processContainer.dispose()],
      ]);
      return stopPromise;
    },
  };

  try {
    mainWindows = new MainWindowManager(processContainer, async (scope) => {
      scope.load(mainWindowModule());
      const windowRef: { current?: BrowserWindow } = {};
      const getWindow = (): BrowserWindow => {
        if (windowRef.current === undefined) {
          throw new Error("Main window is not ready.");
        }
        return windowRef.current;
      };
      const controller = createWindowRpc(
        getWindow,
        scope.get(WINDOW_TOKENS.context)
      );
      scope.onDispose(() => controller.dispose());
      const window = await createMainWindow({
        rpc: controller.rpc,
        windowStates,
      });
      windowRef.current = window;
      scope.load(windowModule({ window, rpcController: controller }));
      attachWindowScope(scope, windowRpcs);
      return {
        window,
        rpc: controller.rpc,
        activate: () => window.activate(),
      };
    });
    remoteServerManager.setStatusListener((payload) =>
      mainWindows?.current()?.rpc.send.remoteServerStatusChanged(payload)
    );
    registerMenuActions(
      () => mainWindows?.current()?.window,
      executeCommand
    );

    deepLink = createDeepLinkHandler({
      localFs,
      githubAuth,
      threadStorages: pluginManager.threadStorages,
      getRpc,
      openAgentProject: (rootPath) => projectWindows.openProject(rootPath),
    });
    const deepLinkScheme = resolveDeepLinkScheme(
      process.env.LLM_SPACE_DEEP_LINK_SCHEME
    );
    const pendingDeepLinks = getPendingDeepLinks();
    setDeepLinkHandler((url) => {
      void (async () => {
        if (!isStudioOpenDeepLink(url, deepLinkScheme)) {
          const main = await _requireMainWindows(mainWindows).open();
          activateWindowForDeepLink(main.window, url, deepLinkScheme);
        }
        await deepLink?.handle(url);
      })().catch((error) => {
          console.error("Failed to handle deep link:", error);
          Utils.showNotification({
            title: "Unable to Open Agent Project",
            body: _errorMessage(error),
          });
        });
    });

    const studioOnlyLaunch =
      pendingDeepLinks.length > 0 &&
      pendingDeepLinks.every((url) => isStudioOpenDeepLink(url, deepLinkScheme));
    if (!studioOnlyLaunch) await mainWindows.open();

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
    Electrobun.events.on("reopen", () => {
      void _requireMainWindows(mainWindows).open().catch((error) => {
        console.error("Failed to reopen Main window:", error);
      });
    });

    return runtime;
  } catch (error) {
    await runtime.stop();
    throw error;
  }
}

function _requireMainWindows(
  value: MainWindowManager<DesktopMainWindowHandle> | undefined
): MainWindowManager<DesktopMainWindowHandle> {
  if (value === undefined) throw new Error("Main window manager is not ready.");
  return value;
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
