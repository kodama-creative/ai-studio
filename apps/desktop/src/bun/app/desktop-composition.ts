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
import Electrobun, { app } from "electrobun/bun";
import {
  Container,
  ContainerModule,
  type ServiceIdentifier,
} from "inversify";

import { resolveDeepLinkScheme } from "../../shared/deep-link-scheme";
import { Analytics } from "../analytics";
import { analyticsRpcModule } from "../analytics/analytics-module";
import { githubAccountRpcModule } from "../auth/github-account-module";
import { GitHubAuthManager } from "../auth/github-auth-manager";
import { auxiliaryGenerationModule } from "../auxiliary-generation/auxiliary-generation-module";
import { auxiliaryGenerationRpcModule } from "../auxiliary-generation/auxiliary-generation-rpc-feature";
import type { DeepLinkSource } from "../deep-link/deep-link-inbox";
import { windowRegistryModule } from "../di/window-registry-module";
import { openPath, revealInFileManager } from "../fs";
import { DesktopHost } from "../host/desktop-host";
import { builtinToolsRpcModule } from "../host/desktop-host-module";
import { mcpRpcModule } from "../mcp/mcp-module";
import { modelsModule } from "../models/models-module";
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
import { nativeWindowContributionsModule } from "../native/native-window-module";
import { promptFilesRpcModule } from "../native/prompt-files-module";
import { shellRpcModule } from "../native/shell-module";
import { networkRpcModule } from "../network/network-module";
import {
  playgroundContributionsModule,
  playgroundModule,
  playgroundWindowModule,
} from "../playgrounds/playground-module";
import { openAgentProject } from "../projects/agent-project";
import {
  agentProjectsModule,
  agentProjectsRpcModule,
} from "../projects/agent-projects-module";
import {
  projectContributionsModule,
  projectWindowModule,
} from "../projects/project-module";
import {
  AGENT_PROJECT_CATALOG_STORE,
  AGENT_PROJECT_LOADER,
  PROJECT_WINDOW_STATE_STORE,
  ProjectWindowManager,
} from "../projects/project-window-manager";
import {
  FileAgentProjectCatalogStore,
  FileProjectWindowStateStore,
} from "../projects/project-window-state";
import { remindersModule } from "../reminders/reminders-module";
import { remindersRpcModule } from "../reminders/reminders-rpc-feature";
import { REMINDERS_STATE_FILE } from "../reminders/state";
import { searchRpcModule } from "../search/search-module";
import { getManagedSkillsDir, seedSkills } from "../skills/seed";
import { skillsRpcModule } from "../skills/skills-module";
import {
  GIST_THREAD_READER,
  GIST_THREAD_WRITER,
  threadSharingModule,
} from "../thread-sharing/thread-sharing-module";
import { threadSharingRpcModule } from "../thread-sharing/thread-sharing-rpc-feature";
import { UpdaterService } from "../updates";
import { UpdatesState } from "../updates/state";
import { updatesRpcModule } from "../updates/updates-module";
import { seedWorkspace } from "../workspace/seed";

import { DesktopApp } from "./desktop-app";
import { DesktopLaunchErrorReporterService } from "./desktop-launch-error-reporter";
import {
  DESKTOP_DEEP_LINK_SCHEME,
  DESKTOP_DEEP_LINK_SOURCE,
  DESKTOP_LAUNCH_ERROR_REPORTER,
  DESKTOP_LAUNCH_TARGETS,
  DesktopLaunchService,
} from "./desktop-launch-service";
import { DesktopLaunchTargetService } from "./desktop-launch-targets";
import { DesktopLifecycle } from "./desktop-lifecycle";
import { DESKTOP_WINDOW_COMMAND_ROUTER } from "./desktop-window-command-router";
import {
  DESKTOP_CONTAINER,
  DESKTOP_WINDOW_COMPOSITION,
  type DesktopWindowComposition,
  DesktopWindowFactory,
} from "./desktop-window-factory";
import { MainWindowManager } from "./main-window-manager";
import { registerMenuActions } from "./menu";
import {
  type BeforeQuitEvent,
  createShutdownCoordinator,
} from "./shutdown-coordinator";
import { WINDOW_CONTAINER_FACTORY } from "./window-container-factory";
import { WindowStateManager } from "./window-state";

/**
 * Compose and start the production Desktop process for one deep-link source.
 *
 * External resources enter the LIFO lifecycle immediately after construction.
 * Any startup failure tears down that lifecycle and the process Container
 * before the original error is rethrown.
 */
export async function composeAndStartDesktopApp(
  deepLinks: DeepLinkSource
): Promise<void> {
  seedWorkspace();

  seedSkills();

  let desktopContainer: Container | undefined;
  let stopProcess: (() => Promise<void>) | undefined;

  try {
    desktopContainer = new Container();
    const processLifecycle = new DesktopLifecycle();
    let stopProcessPromise: Promise<void> | undefined;
    stopProcess = () => {
      stopProcessPromise ??= (async () => {
        await processLifecycle.stop();
        await desktopContainer?.unbindAllAsync();
      })();
      return stopProcessPromise;
    };
    const bindConstant = <T>(
      token: ServiceIdentifier<T>,
      value: T
    ): void => {
      desktopContainer!.bind(token).toConstantValue(value);
    };
    const homePath = getLlmSpaceHomePath();
    const workspacePath = path.join(homePath, "workspace");
    const analytics = new Analytics();
    processLifecycle.defer("analytics", () => analytics.shutdown());
    // Apply the proxy before MCP subprocesses or network requests can start.
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

    // Construct the auth EventHub only after fallible host startup, then keep
    // every remaining process resource inside the container cleanup window.
    const githubAuth = new GitHubAuthManager();
    processLifecycle.defer("GitHub authentication", () => githubAuth.dispose());
    bindConstant(GitHubAuthManager, githubAuth);
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

    // Process service registrations precede every window and application root.
    bindConstant(Analytics, analytics);
    bindConstant(APP_HOME_PATH, homePath);
    bindConstant(DesktopHost, host);
    bindConstant(GIST_THREAD_READER, gistReader);
    bindConstant(GIST_THREAD_WRITER, gistWriter);
    bindConstant(McpManager, mcpManager);
    bindConstant(ModelManager, modelManager);
    bindConstant(NetworkSettingsManager, networkSettings);
    bindConstant(SearchSettingsManager, searchSettings);
    bindConstant(SkillsManager, skillsManager);
    bindConstant(UpdaterService, updater);
    bindConstant(WindowStateManager, windowStates);
    bindConstant(
      REMINDERS_STATE_FILE,
      path.join(homePath, "settings", "reminders.json")
    );
    desktopContainer.load(threadSharingModule());
    desktopContainer.load(remindersModule());
    desktopContainer.load(agentProjectsModule());
    desktopContainer.load(nativeDialogsApplicationModule());
    desktopContainer.load(auxiliaryGenerationModule());
    desktopContainer.load(modelsModule());
    desktopContainer.load(playgroundModule());

    const windowComposition = createDesktopWindowComposition();

    const deepLinkScheme = resolveDeepLinkScheme(
      process.env.LLM_SPACE_DEEP_LINK_SCHEME
    );
    bindConstant(DESKTOP_DEEP_LINK_SOURCE, deepLinks);
    bindConstant(DESKTOP_DEEP_LINK_SCHEME, deepLinkScheme);
    bindConstant(DESKTOP_CONTAINER, desktopContainer);
    bindConstant(DESKTOP_WINDOW_COMPOSITION, windowComposition);
    desktopContainer.bind(DesktopWindowFactory).toSelf().inSingletonScope();
    desktopContainer
      .bind(WINDOW_CONTAINER_FACTORY)
      .toService(DesktopWindowFactory);
    desktopContainer
      .bind(DESKTOP_WINDOW_COMMAND_ROUTER)
      .toService(DesktopWindowFactory);
    desktopContainer
      .bind(FileProjectWindowStateStore)
      .toSelf()
      .inSingletonScope();
    desktopContainer
      .bind(PROJECT_WINDOW_STATE_STORE)
      .toService(FileProjectWindowStateStore);
    desktopContainer
      .bind(FileAgentProjectCatalogStore)
      .toSelf()
      .inSingletonScope();
    desktopContainer
      .bind(AGENT_PROJECT_CATALOG_STORE)
      .toService(FileAgentProjectCatalogStore);
    bindConstant(AGENT_PROJECT_LOADER, { open: openAgentProject });
    desktopContainer.bind(ProjectWindowManager).toSelf().inSingletonScope();
    desktopContainer.bind(MainWindowManager).toSelf().inSingletonScope();
    desktopContainer
      .bind(DesktopLaunchTargetService)
      .toSelf()
      .inSingletonScope();
    desktopContainer
      .bind(DESKTOP_LAUNCH_TARGETS)
      .toService(DesktopLaunchTargetService);
    desktopContainer
      .bind(DesktopLaunchErrorReporterService)
      .toSelf()
      .inSingletonScope();
    desktopContainer
      .bind(DESKTOP_LAUNCH_ERROR_REPORTER)
      .toService(DesktopLaunchErrorReporterService);
    desktopContainer.bind(DesktopLaunchService).toSelf().inSingletonScope();

    // DesktopApp is deliberately the final registration and lifecycle root.
    desktopContainer.load(
      new ContainerModule(({ bind }) => {
        bind(DesktopApp).toSelf().inSingletonScope();
      })
    );
    const desktopApp = desktopContainer.get(DesktopApp);
    const stopDesktop = async (): Promise<void> => {
      await desktopApp.stop();
      await stopProcess!();
    };
    registerMenuActions(
      () => desktopApp.currentMainWindow(),
      (command, window) => desktopApp.executeCommand(command, window)
    );
    const handleBeforeQuit = createShutdownCoordinator({
      quit: () => app.quit(),
      stop: stopDesktop,
    });
    Electrobun.events.on("before-quit", (event) =>
      handleBeforeQuit(event as BeforeQuitEvent)
    );
    Electrobun.events.on("reopen", () => {
      desktopApp.reopen();
    });
    await desktopApp.start();
  } catch (error) {
    if (stopProcess !== undefined) {
      await stopProcess();
    } else {
      await desktopContainer?.unbindAllAsync();
    }
    throw error;
  }
}

/** Define the fixed Main and Project child-Container registration stages. */
export function createDesktopWindowComposition(): DesktopWindowComposition {
  return {
    /** Register Main identity before its runtime contributions resolve. */
    configureMainIdentity(container): void {
      container.load(playgroundWindowModule());
    },

    /** Register Project source services before Studio is resolved. */
    configureProjectSource(container, project): void {
      container.load(projectWindowModule({ source: project }));
    },

    /** Register business contributions and infrastructure before snapshots. */
    configureRuntime(container, { kind, rpcEventSink }): void {
      container.load(threadSharingRpcModule());
      container.load(githubAccountRpcModule());
      container.load(updatesRpcModule());
      container.load(remindersRpcModule());
      container.load(analyticsRpcModule());
      container.load(agentProjectsRpcModule());
      container.load(nativeDialogsContributionsModule());
      container.load(nativeFilesRpcModule());
      container.load(appDirectoriesRpcModule());
      container.load(nativeWindowContributionsModule());
      container.load(shellRpcModule());
      container.load(auxiliaryGenerationRpcModule());
      container.load(modelsRpcModule());
      container.load(promptFilesRpcModule());
      container.load(mcpRpcModule());
      container.load(builtinToolsRpcModule());
      container.load(searchRpcModule());
      container.load(networkRpcModule());
      container.load(skillsRpcModule());
      if (kind === "main") {
        container.load(playgroundContributionsModule());
      } else {
        container.load(projectContributionsModule());
      }
      container.load(windowRegistryModule({ rpcEventSink }));
    },
  };
}
