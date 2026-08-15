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
import Electrobun, { app, type ElectrobunEvent, Utils } from "electrobun/bun";

import { resolveDeepLinkScheme } from "../../shared/deep-link-scheme";
import { Analytics } from "../analytics";
import { auxiliaryGenerationModule } from "../application/auxiliary-generation-module";
import { modelsModule } from "../application/models-module";
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
import {
  createDesktopProcessContainer,
  type DesktopProcessContainer,
} from "../di/process-container";
import { processServicesModule } from "../di/process-module";
import { PROCESS_TOKENS } from "../di/tokens";
import { openPath, revealInFileManager } from "../fs";
import { generatorModule } from "../generator/generator-module";
import { DesktopHost } from "../host/desktop-host";
import { appDirectoriesApplicationModule } from "../native/app-directories-module";
import { nativeDialogsApplicationModule } from "../native/native-dialogs-module";
import { nativeFilesApplicationModule } from "../native/native-files-module";
import { playgroundModule } from "../playgrounds/playground-module";
import { agentProjectsModule } from "../projects/agent-projects-module";
import { ProjectWindowManager } from "../projects/project-window-manager";
import {
  FileAgentProjectCatalogStore,
  FileProjectWindowStateStore,
} from "../projects/project-window-state";
import { remindersModule } from "../reminders/reminders-module";
import { getManagedSkillsDir } from "../skills/seed";
import { UpdaterService } from "../updates";
import { UpdatesState } from "../updates/state";

import { DesktopProcessLifecycle } from "./desktop-process-lifecycle";
import {
  DesktopWindowFactory,
  type DesktopMainWindowHandle,
} from "./desktop-window-factory";
import { MainWindowManager } from "./main-window-manager";
import { registerMenuActions } from "./menu";
import { createShutdownCoordinator } from "./shutdown-coordinator";
import { WindowStateManager } from "./window-state";

export interface DesktopAppRuntime {
  stop(): Promise<void>;
}

/** Build and start the production Bun object graph. */
export async function startDesktopApp(): Promise<DesktopAppRuntime> {
  const processContainer = createDesktopProcessContainer();
  try {
    return await _startDesktopApp(processContainer);
  } catch (error) {
    await _stopDesktopApp([
      ["desktop process scope after startup failure", () =>
        processContainer.dispose()],
    ]);
    throw error;
  }
}

async function _startDesktopApp(
  processContainer: DesktopProcessContainer
): Promise<DesktopAppRuntime> {
  const processLifecycle = new DesktopProcessLifecycle();
  processContainer.onDispose(() => processLifecycle.dispose());
  const homePath = getLlmSpaceHomePath();
  const workspacePath = path.join(homePath, "workspace");
  const analytics = new Analytics();
  processLifecycle.defer("analytics", () => analytics.shutdown());
  // Apply the configured proxy to `process.env` before anything spawns a
  // subprocess (MCP) or makes a request, so egress is routed from the start.
  const networkSettings = new NetworkSettingsManager();
  const mcpManager = new McpManager();
  processLifecycle.defer("MCP manager", () => mcpManager.shutdown());
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
  const githubAuth = new GitHubAuthManager();
  processLifecycle.defer("GitHub auth", () => githubAuth.dispose());
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
  processLifecycle.defer("desktop host", () => host.stop());
  await host.start();

  let notifyUpdateChanged: (
    message: import("../../shared/updates").UpdateStatusChangedPayload
  ) => void = () => undefined;
  const updater = new UpdaterService(
    (message) => notifyUpdateChanged(message),
    new UpdatesState(path.join(homePath, "settings", "updates.json"))
  );
  processLifecycle.defer("updater", () => updater.stop());
  const windowStates = new WindowStateManager();
  processLifecycle.defer("window state", () => windowStates.flush());
  const windowFactory = new DesktopWindowFactory(
    processContainer,
    homePath,
    windowStates
  );
  const projectWindows = new ProjectWindowManager({
    state: new FileProjectWindowStateStore(homePath),
    catalog: new FileAgentProjectCatalogStore(homePath),
    windows: windowFactory,
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
  processContainer.load(nativeDialogsApplicationModule());
  processContainer.load(nativeFilesApplicationModule());
  processContainer.load(appDirectoriesApplicationModule());
  processContainer.load(generatorModule());
  processContainer.load(agentProjectsModule());
  processContainer.load(remindersModule());
  processContainer.load(threadSharingApplicationModule());
  processContainer.load(updatesApplicationModule());
  notifyUpdateChanged = (message) =>
    processContainer
      .get<UpdatesApplication>(UPDATES_APPLICATION)
      .notifyStatus(message);
  // Resolve the lazy application root through DI so its Disposable lifecycle
  // is adopted by the process scope before any window can request it.
  processContainer.get(PROCESS_TOKENS.playgroundApplication);
  processContainer.onDispose(() => {
    // External managers may emit one final callback while shutting down. Stop
    // them from resolving Applications after the DI root entered disposal.
    notifyUpdateChanged = () => undefined;
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
    mainWindows = new MainWindowManager(processContainer, (scope) =>
      windowFactory.createMain(scope)
    );
    registerMenuActions(
      () => mainWindows?.current()?.window,
      (command, window) => windowFactory.executeCommand(command, window)
    );

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
