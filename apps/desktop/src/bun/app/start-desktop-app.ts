import path from "node:path";

import { getLlmSpaceHomePath } from "@llm-space/core/server";
import { GistThreadReader, GistThreadWriter } from "@llm-space/core/storage";
import { McpManager } from "@llm-space/runtime/mcp";
import {
  createConfiguredArkImageGenerator,
  ModelManager,
} from "@llm-space/runtime/models";
import { NetworkSettingsManager } from "@llm-space/runtime/network";
import { LocalRuntimeClient, RuntimeRouter } from "@llm-space/runtime/runtime";
import { SearchSettingsManager } from "@llm-space/runtime/search";
import { SkillsManager } from "@llm-space/runtime/skills";
import { createLocalFileSystem } from "@llm-space/runtime/storage";
import { createBuiltInToolsModule } from "@llm-space/runtime/tools/built-in";
import type { Studio } from "@llm-space/studio/server";
import Electrobun, {
  app,
  type BrowserWindow,
  type ElectrobunEvent,
  Utils,
} from "electrobun/bun";

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
import {
  runtimeApplicationsModule,
  runtimeContributionsModule,
} from "../application/runtime-module";
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
import { ProjectWindowManager } from "../projects/project-window-manager";
import {
  FileAgentProjectCatalogStore,
  FileProjectWindowStateStore,
  ProjectWindowStateFile,
} from "../projects/project-window-state";
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
            agentId: projectStudio.agent.agentSpecId,
            generationId: projectStudio.agent.sourceRevision,
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
      gistReader,
      homePath,
      localFs,
      mcpManager,
      modelManager,
      networkSettings,
      projectWindows,
      runtimeRouter,
      searchSettings,
      skillsManager,
      updater,
      windowStates,
    })
  );
  processContainer.load(runtimeApplicationsModule());
  processContainer.load(nativeApplicationsModule());
  processContainer.load(generatorModule());
  processContainer.load(agentProjectsModule());
  processContainer.load(applicationModule());
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
    notifyGithubChanged = () => undefined;
    notifyUpdateChanged = () => undefined;
    return _stopDesktopApp([
      ["window state", () => windowStates.flush()],
      ["updater", () => updater.stop()],
      ["desktop host", () => host.stop()],
      ["MCP manager", () => mcpManager.shutdown()],
      ["GitHub auth", () => githubAuth.cancelSignIn()],
      ["analytics", () => analytics.shutdown()],
    ]);
  });
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

    const deepLinkScheme = resolveDeepLinkScheme(
      process.env.LLM_SPACE_DEEP_LINK_SCHEME
    );
    const pendingDeepLinks = getPendingDeepLinks();
    setDeepLinkHandler((url) => {
      void (async () => {
        if (isStudioOpenDeepLink(url, deepLinkScheme)) {
          const project = new URL(url).searchParams.get("project")?.trim();
          if (!project) {
            throw new Error("Can't open Studio: the project path is missing.");
          }
          await projectWindows.openProject(project);
        } else {
          const main = await _requireMainWindows(mainWindows).open();
          activateWindowForDeepLink(main.window, url, deepLinkScheme);
        }
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
  scope.load(runtimeContributionsModule(scope));
  if (kind === "main") {
    scope.load(playgroundContributionsModule(scope));
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

function _errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
