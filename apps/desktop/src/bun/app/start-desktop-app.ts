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
import {
  ANALYTICS,
  analyticsRpcModule,
} from "../analytics/analytics-module";
import {
  GITHUB_AUTH,
  githubAccountRpcModule,
} from "../auth/github-account-module";
import { GitHubAuthManager } from "../auth/github-auth-manager";
import { auxiliaryGenerationModule } from "../auxiliary-generation/auxiliary-generation-module";
import { auxiliaryGenerationRpcModule } from "../auxiliary-generation/auxiliary-generation-rpc-feature";
import { activateWindowForDeepLink } from "../deep-link/activate-window";
import { desktopDeepLinks } from "../deep-link/launch";
import {
  createDesktopProcessContainer,
  type DesktopProcessContainer,
  type DesktopWindowScope,
} from "../di/process-container";
import { openPath, revealInFileManager } from "../fs";
import { DesktopHost } from "../host/desktop-host";
import {
  DESKTOP_HOST,
  builtinToolsRpcModule,
} from "../host/desktop-host-module";
import { MCP_MANAGER, mcpRpcModule } from "../mcp/mcp-module";
import { MODEL_MANAGER, modelsModule } from "../models/models-module";
import { modelsRpcModule } from "../models/models-rpc-feature";
import {
  APP_HOME_PATH,
  appDirectoriesRpcModule,
} from "../native/app-directories-module";
import {
  nativeDialogsApplicationModule,
  nativeDialogsContributionsModule,
} from "../native/native-dialogs-module";
import { nativeFilesRpcModule } from "../native/native-files-module";
import {
  nativeWindowContributionsModule,
  WINDOW_STATE_MANAGER,
} from "../native/native-window-module";
import { promptFilesRpcModule } from "../native/prompt-files-module";
import { shellCommandsModule } from "../native/shell-module";
import {
  NETWORK_SETTINGS,
  networkRpcModule,
} from "../network/network-module";
import {
  PLAYGROUND_APPLICATION,
  playgroundContributionsModule,
  playgroundModule,
} from "../playgrounds/playground-module";
import {
  agentProjectsCommandModule,
  agentProjectsModule,
  agentProjectsRpcModule,
  PROJECT_WINDOW_MANAGER,
} from "../projects/agent-projects-module";
import { projectContributionsModule } from "../projects/project-module";
import { ProjectWindowManager } from "../projects/project-window-manager";
import {
  FileAgentProjectCatalogStore,
  FileProjectWindowStateStore,
} from "../projects/project-window-state";
import { remindersModule } from "../reminders/reminders-module";
import { remindersRpcModule } from "../reminders/reminders-rpc-feature";
import { SEARCH_SETTINGS, searchRpcModule } from "../search/search-module";
import { getManagedSkillsDir } from "../skills/seed";
import { SKILLS_MANAGER, skillsRpcModule } from "../skills/skills-module";
import {
  GIST_THREAD_READER,
  GIST_THREAD_WRITER,
  threadSharingModule,
} from "../thread-sharing/thread-sharing-module";
import { threadSharingRpcModule } from "../thread-sharing/thread-sharing-rpc-feature";
import { UpdaterService } from "../updates";
import { UpdatesState } from "../updates/state";
import { UPDATER, updatesRpcModule } from "../updates/updates-module";

import { DesktopLaunchController } from "./desktop-launch-controller";
import {
  type DesktopAppRuntime,
  DesktopLifecycle,
} from "./desktop-lifecycle";
import { DesktopWindowFactory } from "./desktop-window-factory";
import type { DesktopWindowCompositionContext } from "./desktop-window-runtime";
import { MainWindowManager } from "./main-window-manager";
import { registerMenuActions } from "./menu";
import { createShutdownCoordinator } from "./shutdown-coordinator";
import { WindowStateManager } from "./window-state";

/** Install the explicit Common/Main/Project module set into one child scope. */
export function configureDesktopWindowScope(
  scope: DesktopWindowScope,
  { kind, commandSink }: DesktopWindowCompositionContext
): void {
  scope.load(threadSharingRpcModule());
  scope.load(githubAccountRpcModule());
  scope.load(updatesRpcModule());
  scope.load(remindersRpcModule());
  scope.load(analyticsRpcModule());
  scope.load(agentProjectsCommandModule());
  scope.load(nativeDialogsContributionsModule(commandSink));
  scope.load(nativeFilesRpcModule());
  scope.load(appDirectoriesRpcModule());
  scope.load(nativeWindowContributionsModule());
  scope.load(shellCommandsModule());
  scope.load(auxiliaryGenerationRpcModule());
  scope.load(modelsRpcModule());
  scope.load(promptFilesRpcModule());
  scope.load(mcpRpcModule());
  scope.load(builtinToolsRpcModule());
  scope.load(searchRpcModule());
  scope.load(networkRpcModule());
  scope.load(skillsRpcModule());
  if (kind === "main") {
    scope.load(agentProjectsRpcModule());
    scope.load(playgroundContributionsModule());
  } else {
    scope.load(projectContributionsModule());
  }
}

/** Build and start the production Bun object graph. */
export async function startDesktopApp(): Promise<DesktopAppRuntime> {
  const processContainer = createDesktopProcessContainer();
  try {
    return await _startDesktopApp(processContainer);
  } catch (error) {
    const startupFailure = new DesktopLifecycle();
    startupFailure.defer("desktop process scope after startup failure", () =>
      processContainer.dispose()
    );
    await startupFailure.stop();
    throw error;
  }
}

async function _startDesktopApp(
  processContainer: DesktopProcessContainer
): Promise<DesktopAppRuntime> {
  const processLifecycle = new DesktopLifecycle();
  processContainer.onDispose(() => processLifecycle.stop());
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

  // Construct the disposable auth manager only after the fallible host startup
  // and immediately before the process services are adopted below. This keeps
  // every live auth EventHub inside the process container's cleanup window.
  const githubAuth = new GitHubAuthManager();
  // Write-side gist connector for the "Share thread" flow. Reuses the signed-in
  // GitHub token (the `gist` scope); creates secret gists readable by URL.
  const gistWriter = new GistThreadWriter({
    getToken: () => githubAuth.getAccessToken(),
  });
  const gistReader = new GistThreadReader({
    getToken: () => githubAuth.getAccessToken(),
  });
  const updater = new UpdaterService(
    new UpdatesState(path.join(homePath, "settings", "updates.json"))
  );
  processLifecycle.defer("updater", () => updater.stop());
  const windowStates = new WindowStateManager();
  processLifecycle.defer("window state", () => windowStates.flush());
  const windowFactory = new DesktopWindowFactory(
    processContainer,
    homePath,
    configureDesktopWindowScope
  );
  const projectWindows = new ProjectWindowManager({
    state: new FileProjectWindowStateStore(homePath),
    catalog: new FileAgentProjectCatalogStore(homePath),
    windows: windowFactory,
  });
  // DI resolution remains confined to this composition root; feature classes
  // still receive ordinary constructor arguments instead of the Container.
  processContainer.bindConstant(ANALYTICS, analytics);
  processContainer.bindConstant(APP_HOME_PATH, homePath);
  processContainer.bindConstant(DESKTOP_HOST, host);
  processContainer.bindConstant(GITHUB_AUTH, githubAuth);
  processContainer.bindConstant(GIST_THREAD_READER, gistReader);
  processContainer.bindConstant(GIST_THREAD_WRITER, gistWriter);
  processContainer.bindConstant(MCP_MANAGER, mcpManager);
  processContainer.bindConstant(MODEL_MANAGER, modelManager);
  processContainer.bindConstant(NETWORK_SETTINGS, networkSettings);
  processContainer.bindConstant(PROJECT_WINDOW_MANAGER, projectWindows);
  processContainer.bindConstant(SEARCH_SETTINGS, searchSettings);
  processContainer.bindConstant(SKILLS_MANAGER, skillsManager);
  processContainer.bindConstant(UPDATER, updater);
  processContainer.bindConstant(WINDOW_STATE_MANAGER, windowStates);
  processContainer.load(threadSharingModule());
  processContainer.load(remindersModule());
  processContainer.load(agentProjectsModule());
  processContainer.load(nativeDialogsApplicationModule());
  processContainer.load(auxiliaryGenerationModule());
  processContainer.load(modelsModule());
  processContainer.load(playgroundModule());
  // Resolve the lazy application root through DI so its Disposable lifecycle
  // is adopted by the process scope before any window can request it.
  processContainer.get(PLAYGROUND_APPLICATION);
  const mainWindows = new MainWindowManager(processContainer, (scope) =>
    windowFactory.createMain(scope)
  );
  const deepLinkScheme = resolveDeepLinkScheme(
    process.env.LLM_SPACE_DEEP_LINK_SCHEME
  );
  const launch = new DesktopLaunchController({
    deepLinks: desktopDeepLinks,
    scheme: deepLinkScheme,
    targets: {
      async openMain(url) {
        const main = await mainWindows.open();
        if (url !== undefined) {
          activateWindowForDeepLink(main.window, url, deepLinkScheme);
        }
      },
      openProject: (rootPath) => projectWindows.openProject(rootPath),
    },
    onOpenError(error) {
      console.error("Failed to handle deep link:", error);
      Utils.showNotification({
        title: "Unable to Open Agent Project",
        body: error.message,
      });
    },
  });
  const runtime = new DesktopLifecycle();
  runtime.defer("desktop process scope", () => processContainer.dispose());
  runtime.defer("agent project windows", () => projectWindows.closeAll());
  runtime.defer("desktop launch", () => launch.dispose());

  try {
    registerMenuActions(
      () => mainWindows.current()?.window,
      (command, window) => windowFactory.executeCommand(command, window)
    );
    await launch.start();

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
      launch.reopen();
    });

    return runtime;
  } catch (error) {
    await runtime.stop();
    throw error;
  }
}
