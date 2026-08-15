import path from "node:path";

import { getLlmSpaceHomePath } from "@llm-space/core/server";
import { GistThreadReader, GistThreadWriter } from "@llm-space/core/storage";
import { McpManager } from "@llm-space/runtime/mcp";
import {
  createConfiguredArkImageGenerator,
  ModelManager,
} from "@llm-space/runtime/models";
import { NetworkSettingsManager } from "@llm-space/runtime/network";
import { SearchSettingsManager } from "@llm-space/runtime/search";
import { SkillsManager } from "@llm-space/runtime/skills";
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
import { analyticsApplicationModule } from "../application/analytics-application";
import { auxiliaryGenerationModule } from "../application/auxiliary-generation-module";
import { generatorModule } from "../application/generator-module";
import {
  GITHUB_ACCOUNT_APPLICATION,
  GithubAccountApplication,
  githubAccountApplicationModule,
} from "../application/github-account-application";
import { modelsModule } from "../application/models-module";
import type { WindowApplication } from "../application/native-applications";
import {
  nativeApplicationsModule,
  NATIVE_APPLICATION_TOKENS,
} from "../application/native-module";
import { remindersApplicationModule } from "../application/reminders-application";
import { threadSharingApplicationModule } from "../application/thread-sharing-application";
import {
  UPDATES_APPLICATION,
  UpdatesApplication,
  updatesApplicationModule,
} from "../application/updates-application";
import { GitHubAuthManager } from "../auth/github-auth-manager";
import { isStudioOpenDeepLink } from "../deep-link";
import { activateWindowForDeepLink } from "../deep-link/activate-window";
import { getPendingDeepLinks, setDeepLinkHandler } from "../deep-link/launch";
import { createDesktopProcessContainer } from "../di/process-container";
import { processServicesModule } from "../di/process-module";
import { PROCESS_TOKENS, PROJECT_WINDOW_TOKENS } from "../di/tokens";
import { openPath, revealInFileManager } from "../fs";
import { DesktopHost } from "../host/desktop-host";
import {
  playgroundModule,
  playgroundWindowModule,
} from "../playgrounds/playground-module";
import {
  projectWindowIdentityModule,
  projectWindowModule,
} from "../projects/project-module";
import { ProjectWindowManager } from "../projects/project-window-manager";
import {
  FileAgentProjectCatalogStore,
  FileProjectWindowStateStore,
  ProjectWindowStateFile,
} from "../projects/project-window-state";
import type { MainWindowRPC } from "../rpc";
import { getManagedSkillsDir } from "../skills/seed";
import { UpdaterService } from "../updates";

import { DesktopWindowRuntime } from "./desktop-window-runtime";
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

  let notifyUpdateChanged: (
    message: import("../../shared/updates").UpdateStatusChangedPayload
  ) => void = () => undefined;
  const updater = new UpdaterService((message) => notifyUpdateChanged(message));
  const windowStates = new WindowStateManager();
  const windowRuntimes = new Map<number, DesktopWindowRuntime>();
  const executeCommand = (
    command: Command,
    window: BrowserWindow
  ): void => {
    const runtime = windowRuntimes.get(window.id);
    if (runtime === undefined) {
      throw new Error(
        `DesktopWindowRuntime is unavailable for window ${window.id}.`
      );
    }
    runtime.execute(command);
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
          const runtime = new DesktopWindowRuntime(scope, "project");
          const stateStore = await ProjectWindowStateFile.load(
            homePath,
            project.id
          );
          const projectWindow = await createAgentProjectWindow({
            rpc: runtime.rpc,
            project: scope.get(PROJECT_WINDOW_TOKENS.project),
            stateStore,
            windowStates,
            onFullScreenChange: (fullScreen) =>
              scope
                .get<WindowApplication>(NATIVE_APPLICATION_TOKENS.window)
                .notifyFullScreenChanged(fullScreen),
          });
          runtime.attach(projectWindow);
          windowRuntimes.set(projectWindow.id, runtime);
          scope.onDisposed(() => windowRuntimes.delete(projectWindow.id));
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
    processServicesModule({
      analytics,
      desktopHost: host,
      githubAuth,
      gistWriter,
      gistReader,
      homePath,
      mcpManager,
      modelManager,
      networkSettings,
      projectWindows,
      searchSettings,
      skillsManager,
      updater,
      windowStates,
    })
  );
  processContainer.load(playgroundModule());
  processContainer.load(auxiliaryGenerationModule());
  processContainer.load(modelsModule());
  processContainer.load(nativeApplicationsModule());
  processContainer.load(generatorModule());
  processContainer.load(agentProjectsModule());
  processContainer.load(threadSharingApplicationModule());
  processContainer.load(githubAccountApplicationModule());
  processContainer.load(updatesApplicationModule());
  processContainer.load(remindersApplicationModule());
  processContainer.load(analyticsApplicationModule());
  notifyGithubChanged = (state) =>
    processContainer
      .get<GithubAccountApplication>(GITHUB_ACCOUNT_APPLICATION)
      .notifyChanged(state);
  notifyUpdateChanged = (message) =>
    processContainer
      .get<UpdatesApplication>(UPDATES_APPLICATION)
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
      scope.load(playgroundWindowModule());
      const runtime = new DesktopWindowRuntime(scope, "main");
      const window = await createMainWindow({
        rpc: runtime.rpc,
        windowStates,
        onFullScreenChange: (fullScreen) =>
          scope
            .get<WindowApplication>(NATIVE_APPLICATION_TOKENS.window)
            .notifyFullScreenChanged(fullScreen),
      });
      runtime.attach(window);
      windowRuntimes.set(window.id, runtime);
      scope.onDisposed(() => windowRuntimes.delete(window.id));
      return {
        window,
        rpc: runtime.rpc,
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
