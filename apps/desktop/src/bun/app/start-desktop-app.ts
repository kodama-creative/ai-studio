import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { getLlmSpaceHomePath } from "@llm-space/core/server";
import { GistThreadReader, GistThreadWriter } from "@llm-space/core/storage";
import { McpManager } from "@llm-space/runtime/mcp";
import {
  createConfiguredArkImageGenerator,
  ModelManager,
} from "@llm-space/runtime/models";
import { NetworkSettingsManager } from "@llm-space/runtime/network";
import { PluginManager } from "@llm-space/runtime/plugins";
import { LocalRuntimeClient, RuntimeRouter } from "@llm-space/runtime/runtime";
import { SearchSettingsManager } from "@llm-space/runtime/search";
import { SkillsManager } from "@llm-space/runtime/skills";
import { createLocalFileSystem } from "@llm-space/runtime/storage";
import { StreamThreadController } from "@llm-space/runtime/streaming";
import { createBuiltInToolsModule } from "@llm-space/runtime/tools/built-in";
import type { Studio } from "@llm-space/studio/server";
import Electrobun, {
  app,
  type BrowserWindow,
  type ElectrobunEvent,
  Utils,
  PATHS,
} from "electrobun/bun";

import packageJson from "../../../package.json";
import type { AgentProjectView } from "../../shared/agent-project";
import type { Command } from "../../shared/commands";
import { resolveDeepLinkScheme } from "../../shared/deep-link-scheme";
import { Analytics } from "../analytics";
import { agentProjectsModule } from "../application/agent-projects-module";
import { agentProjectsContributionsModule } from "../application/agent-projects-module";
import {
  applicationContributionsModule,
  applicationModule,
  APPLICATION_TOKENS,
} from "../application/application-module";
import type {
  GithubAccountApplication,
  UpdatesApplication,
} from "../application/application-services";
import {
  generatorContributionsModule,
  generatorModule,
} from "../application/generator-module";
import type { WindowApplication } from "../application/native-applications";
import {
  nativeApplicationsModule,
  nativeContributionsModule,
  NATIVE_APPLICATION_TOKENS,
} from "../application/native-module";
import type {
  PluginCommandsApplication,
  PluginsApplication,
} from "../application/plugin-applications";
import {
  pluginContributionsModule,
  pluginModule,
  PLUGIN_APPLICATION_TOKENS,
} from "../application/plugin-module";
import {
  remoteContributionsModule,
  remoteModule,
} from "../application/remote-module";
import {
  runtimeApplicationsModule,
  runtimeContributionsModule,
} from "../application/runtime-module";
import type { SharedImportApplication } from "../application/shared-import-application";
import {
  sharedImportContributionsModule,
  sharedImportModule,
  SHARED_IMPORT_APPLICATION,
} from "../application/shared-import-module";
import { GitHubAuthManager } from "../auth/github-auth-manager";
import { isStudioOpenDeepLink } from "../deep-link";
import { activateWindowForDeepLink } from "../deep-link/activate-window";
import { getPendingDeepLinks, setDeepLinkHandler } from "../deep-link/launch";
import { CommandRegistry, type CommandSink } from "../di/command-registry";
import {
  mainWindowModule,
  playgroundContributionsModule,
  processModule,
  projectContributionsModule,
  projectWindowIdentityModule,
  projectWindowModule,
  windowModule,
} from "../di/modules";
import {
  createDesktopProcessContainer,
  type DesktopWindowScope,
} from "../di/process-container";
import { RpcRegistry, type RpcEventSink } from "../di/rpc-registry";
import { PROCESS_TOKENS, PROJECT_WINDOW_TOKENS } from "../di/tokens";
import { windowRegistryModule } from "../di/window-registry-module";
import { attachWindowScope } from "../di/window-scope";
import { moveToTrash, openPath, revealInFileManager } from "../fs";
import { DesktopHost } from "../host/desktop-host";
import {
  PluginCommandExecutionController,
  type PluginCommandReportInput,
} from "../plugins/plugin-command-execution-controller";
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
import { getManagedSkillsDir } from "../skills/seed";
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
  let mainWindows: MainWindowManager<DesktopMainWindowHandle> | undefined;
  let notifyGithubChanged: (
    state: import("../../shared/auth").GithubAuthState
  ) => void = () => undefined;
  const githubAuth = new GitHubAuthManager({
    onChange: (state) => notifyGithubChanged(state),
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
  let notifyPluginsChanged = (): void => undefined;
  let notifyPluginCommandExecution: (
    event: import("../../shared/plugin-command-execution").PluginCommandExecutionEvent
  ) => void = () => undefined;
  const pluginManager = await PluginManager.create({
    homePath,
    appVersion: packageJson.version,
    runnerPath: existsSync(packagedRunnerPath)
      ? packagedRunnerPath
      : sourceRunnerPath,
    skillsManager,
    mcpManager,
    modelManager,
    onChanged: () => notifyPluginsChanged(),
    handleHostRequest: async (method, rawParams) => {
      const params = (rawParams ?? {}) as Record<string, unknown>;
      if (method === "notify") {
        Utils.showNotification({
          title: "LLM Space",
          body: _stringParam(params, "message"),
        });
        return null;
      }
      if (method === "shell.openLink") {
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
  const pluginCommandExecutions = new PluginCommandExecutionController(
    {
      execute: (commandId, context, args, executionId) =>
        pluginManager.commands.executeWithContext(
          commandId,
          context,
          args,
          executionId
        ),
    },
    (event) => notifyPluginCommandExecution(event)
  );
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
    rmPath: async (workspacePath) => {
      const abs = localFs.realpath(workspacePath);
      if (abs === localFs.realpath("")) {
        throw new Error("Cannot delete the workspace root.");
      }
      await moveToTrash(abs);
    },
  });
  const runtimeRouter = new RuntimeRouter(localRuntime);
  const remoteServerManager = new RemoteServerManager(runtimeRouter);
  const remoteRuntime = await registerConfiguredRemoteRuntime({
    env: process.env,
    runtimeRouter,
  });

  let notifyUpdateChanged: (
    message: import("../../shared/updates").UpdateStatusChangedPayload
  ) => void = () => undefined;
  const updater = new UpdaterService((message) => notifyUpdateChanged(message));
  const windowStates = new WindowStateManager();
  const commandRegistries = new Map<number, CommandRegistry>();
  const executeCommand = (command: Command, window: BrowserWindow): void => {
    const commands = commandRegistries.get(window.id);
    if (commands === undefined) {
      throw new Error(
        `CommandRegistry is unavailable for window ${window.id}.`
      );
    }
    commands.execute(command);
  };
  const projectWindows = new ProjectWindowManager({
    state: new FileProjectWindowStateStore(homePath),
    catalog: new FileAgentProjectCatalogStore(homePath),
    windows: {
      async create(project) {
        const scope = processContainer.createWindowScope(
          `project:${project.id}`
        );
        try {
          scope.load(projectWindowModule({ source: project }));
          const projectStudio = scope.own(
            await scope.getAsync<Studio>(PROJECT_WINDOW_TOKENS.studio)
          );
          const projectView: AgentProjectView = {
            id: project.id,
            name: project.name,
            rootPath: project.rootPath,
            agentRoot: project.agentRoot,
            agentId: projectStudio.agent.agentId,
            generationId: projectStudio.agent.generationId,
          };
          scope.load(projectWindowIdentityModule(projectView));
          const closed = new Set<() => void>();
          scope.onDisposed(() => closed.forEach((listener) => listener()));
          const projectWindowRef: { current?: BrowserWindow } = {};
          const getProjectWindow = (): BrowserWindow => {
            if (projectWindowRef.current === undefined) {
              throw new Error("Agent project window is not ready.");
            }
            return projectWindowRef.current;
          };
          const infrastructure = _createWindowInfrastructure(
            scope,
            "project",
            getProjectWindow
          );
          const stateStore = await ProjectWindowStateFile.load(
            homePath,
            project.id
          );
          const projectWindow = await createAgentProjectWindow({
            rpc: infrastructure.controller.rpc,
            project: scope.get(PROJECT_WINDOW_TOKENS.project),
            stateStore,
            windowStates,
            onFullScreenChange: (fullScreen) =>
              scope
                .get<WindowApplication>(NATIVE_APPLICATION_TOKENS.window)
                .notifyFullScreenChanged(fullScreen),
          });
          projectWindowRef.current = projectWindow;
          scope.load(
            windowModule({
              window: projectWindow,
              rpcController: infrastructure.controller,
            })
          );
          attachWindowScope(scope);
          commandRegistries.set(projectWindow.id, infrastructure.commands);
          scope.onDisposed(() => commandRegistries.delete(projectWindow.id));
          scope.onDispose(() =>
            _disposeWindowRegistries(
              infrastructure.commands,
              infrastructure.rpc
            )
          );
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
      localFs,
      mcpManager,
      modelManager,
      networkSettings,
      pluginCommandExecutions,
      pluginManager,
      projectWindows,
      remoteServerManager,
      runtimeRouter,
      searchSettings,
      skillsManager,
      streaming,
      updater,
      windowStates,
    })
  );
  processContainer.load(runtimeApplicationsModule());
  processContainer.load(nativeApplicationsModule());
  processContainer.load(generatorModule());
  processContainer.load(agentProjectsModule());
  processContainer.load(remoteModule());
  processContainer.load(pluginModule());
  processContainer.load(applicationModule());
  processContainer.load(sharedImportModule());
  notifyPluginsChanged = () =>
    processContainer
      .get<PluginsApplication>(PLUGIN_APPLICATION_TOKENS.plugins)
      .notifyChanged();
  notifyPluginCommandExecution = (event) =>
    processContainer
      .get<PluginCommandsApplication>(PLUGIN_APPLICATION_TOKENS.commands)
      .notifyExecutionChanged(event);
  notifyGithubChanged = (state) =>
    processContainer
      .get<GithubAccountApplication>(APPLICATION_TOKENS.github)
      .notifyChanged(state);
  notifyUpdateChanged = (message) =>
    processContainer
      .get<UpdatesApplication>(APPLICATION_TOKENS.updates)
      .notifyStatus(message);
  // Resolve the lazy application root through DI so its Disposable lifecycle
  // is adopted by the process scope before any window can request it.
  processContainer.get(PROCESS_TOKENS.playgroundHost);
  processContainer.onDispose(() => {
    // External managers may emit one final callback while shutting down. Stop
    // them from resolving Applications after the DI root entered disposal.
    notifyPluginsChanged = () => undefined;
    notifyPluginCommandExecution = () => undefined;
    notifyGithubChanged = () => undefined;
    notifyUpdateChanged = () => undefined;
    return _stopDesktopApp([
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
  });
  executePluginHostCommand = async (type) => {
    if (type !== "app.openSettings" && type !== "workspace.refresh") {
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
      const infrastructure = _createWindowInfrastructure(
        scope,
        "main",
        getWindow
      );
      const window = await createMainWindow({
        rpc: infrastructure.controller.rpc,
        windowStates,
        onFullScreenChange: (fullScreen) =>
          scope
            .get<WindowApplication>(NATIVE_APPLICATION_TOKENS.window)
            .notifyFullScreenChanged(fullScreen),
      });
      windowRef.current = window;
      scope.load(
        windowModule({
          window,
          rpcController: infrastructure.controller,
        })
      );
      attachWindowScope(scope);
      commandRegistries.set(window.id, infrastructure.commands);
      scope.onDisposed(() => commandRegistries.delete(window.id));
      scope.onDispose(() =>
        _disposeWindowRegistries(infrastructure.commands, infrastructure.rpc)
      );
      return {
        window,
        rpc: infrastructure.controller.rpc,
        activate: () => window.activate(),
      };
    });
    registerMenuActions(() => mainWindows?.current()?.window, executeCommand);

    const sharedImport = processContainer.get<SharedImportApplication>(
      SHARED_IMPORT_APPLICATION
    );
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
        await sharedImport.handle(url);
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
      pendingDeepLinks.every((url) =>
        isStudioOpenDeepLink(url, deepLinkScheme)
      );
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
      void _requireMainWindows(mainWindows)
        .open()
        .catch((error) => {
          console.error("Failed to reopen Main window:", error);
        });
    });

    return runtime;
  } catch (error) {
    await runtime.stop();
    throw error;
  }
}

type DesktopWindowKind = "main" | "project";

interface WindowInfrastructure {
  readonly commands: CommandRegistry;
  readonly rpc: RpcRegistry;
  readonly controller: MainWindowRPCController;
}

/**
 * Compose and start one window's feature contributions before Electrobun
 * exposes the bridge. Only this composition root can see the window DI scope.
 */
function _createWindowInfrastructure(
  scope: DesktopWindowScope,
  kind: DesktopWindowKind,
  getWindow: () => BrowserWindow
): WindowInfrastructure {
  const rpcRef: { current?: MainWindowRPC } = {};
  const requireRpc = (): MainWindowRPC => {
    if (rpcRef.current === undefined) {
      throw new Error(`RPC bridge for ${kind} window is not ready.`);
    }
    return rpcRef.current;
  };
  const commandSink: CommandSink = {
    sendToWebview: (command) => requireRpc().send.executeCommand(command),
  };
  const rpcEventSink: RpcEventSink = {
    sendStreamEvent: (event) =>
      requireRpc().send.rpcNamespaceStreamEvent(event),
    sendEvent: (event) => requireRpc().send.rpcNamespaceEvent(event),
  };

  scope.load(applicationContributionsModule(scope));
  scope.load(agentProjectsContributionsModule(scope, kind === "main"));
  scope.load(generatorContributionsModule(scope));
  scope.load(nativeContributionsModule(scope, { getWindow, commandSink }));
  scope.load(pluginContributionsModule(scope));
  scope.load(runtimeContributionsModule(scope));
  if (kind === "main") {
    scope.load(playgroundContributionsModule(scope));
    scope.load(remoteContributionsModule(scope));
    scope.load(sharedImportContributionsModule(scope));
  } else {
    scope.load(projectContributionsModule(scope));
  }
  scope.load(windowRegistryModule(scope, { commandSink, rpcEventSink }));

  const commands = scope.get(CommandRegistry);
  const rpc = scope.get(RpcRegistry);
  commands.onStart();
  rpc.onStart();
  const controller = createMainWindowRPC({
    executeCommand: (command) => commands.execute(command),
    rpcRegistry: rpc,
  });
  rpcRef.current = controller.rpc;
  return { commands, rpc, controller };
}

/** Stop transport registries before feature contribution instances are freed. */
async function _disposeWindowRegistries(
  commands: CommandRegistry,
  rpc: RpcRegistry
): Promise<void> {
  await rpc.dispose();
  await commands.dispose();
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
