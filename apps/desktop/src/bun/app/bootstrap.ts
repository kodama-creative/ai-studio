import path from "node:path";

import { hydrateShellEnv } from "../env/hydrate";

/** Initialize prerequisites, compose the process container, and start Desktop. */
export async function bootstrapDesktopApp(): Promise<void> {
  hydrateShellEnv();

  // Capture cold-start links before the longer bootstrap imports evaluate.
  const { desktopDeepLinks } = await import("../deep-link/launch");

  const { seedWorkspace } = await import("../workspace/seed");
  seedWorkspace();

  const { getManagedSkillsDir, seedSkills } = await import("../skills/seed");
  seedSkills();

  const { DesktopLifecycle } = await import("./desktop-lifecycle");
  let desktopContainer: import("inversify").Container | undefined;
  let stopProcess: (() => Promise<void>) | undefined;

  try {
    const { Container, ContainerModule } = await import("inversify");
    desktopContainer = new Container();
    const { getLlmSpaceHomePath } = await import("@llm-space/core/server");
    const { GistThreadReader, GistThreadWriter } =
      await import("@llm-space/core/storage");
    const { McpManager } = await import("@llm-space/runtime/mcp");
    const { createConfiguredArkImageGenerator, ModelManager } =
      await import("@llm-space/runtime/models");
    const { NetworkSettingsManager } =
      await import("@llm-space/runtime/network");
    const { SearchSettingsManager } = await import("@llm-space/runtime/search");
    const { SkillsManager } = await import("@llm-space/runtime/skills");
    const { createBuiltInToolsModule } =
      await import("@llm-space/runtime/tools/built-in");
    const electrobun = await import("electrobun/bun");
    const { app } = electrobun;
    const { resolveDeepLinkScheme } =
      await import("../../shared/deep-link-scheme");
    const { Analytics } = await import("../analytics");
    const { ANALYTICS } = await import("../analytics/analytics-module");
    const { GITHUB_AUTH } = await import("../auth/github-account-module");
    const { GitHubAuthManager } = await import("../auth/github-auth-manager");
    const { auxiliaryGenerationModule } =
      await import("../auxiliary-generation/auxiliary-generation-module");
    const { openPath, revealInFileManager } = await import("../fs");
    const { DesktopHost } = await import("../host/desktop-host");
    const { DESKTOP_HOST } = await import("../host/desktop-host-module");
    const { MCP_MANAGER } = await import("../mcp/mcp-module");
    const { modelsModule } = await import("../models/models-module");
    const { APP_HOME_PATH } = await import("../native/app-directories-module");
    const { nativeDialogsApplicationModule } =
      await import("../native/native-dialogs-module");
    const { WINDOW_STATE_MANAGER } =
      await import("../native/native-window-module");
    const { NETWORK_SETTINGS } = await import("../network/network-module");
    const { playgroundModule } =
      await import("../playgrounds/playground-module");
    const { agentProjectsModule } =
      await import("../projects/agent-projects-module");
    const {
      AGENT_PROJECT_LOADER,
      AGENT_PROJECT_CATALOG_STORE,
      PROJECT_WINDOW_STATE_STORE,
      ProjectWindowManager,
    } = await import("../projects/project-window-manager");
    const { FileAgentProjectCatalogStore, FileProjectWindowStateStore } =
      await import("../projects/project-window-state");
    const { openAgentProject } = await import("../projects/agent-project");
    const { remindersModule } = await import("../reminders/reminders-module");
    const { REMINDERS_STATE_FILE } = await import("../reminders/state");
    const { SEARCH_SETTINGS } = await import("../search/search-module");
    const { SKILLS_MANAGER } = await import("../skills/skills-module");
    const { GIST_THREAD_READER, GIST_THREAD_WRITER, threadSharingModule } =
      await import("../thread-sharing/thread-sharing-module");
    const { UpdaterService } = await import("../updates");
    const { UpdatesState } = await import("../updates/state");
    const { UPDATER } = await import("../updates/updates-module");
    const { DesktopApp } = await import("./desktop-app");
    const {
      DESKTOP_DEEP_LINK_SCHEME,
      DESKTOP_DEEP_LINK_SOURCE,
      DESKTOP_LAUNCH_ERROR_REPORTER,
      DESKTOP_LAUNCH_TARGETS,
      DesktopLaunchService,
    } = await import("./desktop-launch-service");
    const {
      DESKTOP_CONTAINER,
      DESKTOP_WINDOW_COMPOSITION,
      DesktopWindowFactory,
    } = await import("./desktop-window-factory");
    const { DESKTOP_WINDOW_COMMAND_ROUTER } =
      await import("./desktop-window-command-router");
    const { WINDOW_CONTAINER_FACTORY } =
      await import("./window-container-factory");
    const { DesktopLaunchErrorReporterService } =
      await import("./desktop-launch-error-reporter");
    const { DesktopLaunchTargetService } =
      await import("./desktop-launch-targets");
    const { MainWindowManager } = await import("./main-window-manager");
    const { registerMenuActions } = await import("./menu");
    const { createShutdownCoordinator } =
      await import("./shutdown-coordinator");
    const { WindowStateManager } = await import("./window-state");

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
      token: import("inversify").ServiceIdentifier<T>,
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
    bindConstant(GITHUB_AUTH, githubAuth);
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
    bindConstant(ANALYTICS, analytics);
    bindConstant(APP_HOME_PATH, homePath);
    bindConstant(DESKTOP_HOST, host);
    bindConstant(GIST_THREAD_READER, gistReader);
    bindConstant(GIST_THREAD_WRITER, gistWriter);
    bindConstant(MCP_MANAGER, mcpManager);
    bindConstant(ModelManager, modelManager);
    bindConstant(NETWORK_SETTINGS, networkSettings);
    bindConstant(SEARCH_SETTINGS, searchSettings);
    bindConstant(SKILLS_MANAGER, skillsManager);
    bindConstant(UPDATER, updater);
    bindConstant(WINDOW_STATE_MANAGER, windowStates);
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

    const windowComposition = await createDesktopWindowComposition();

    const deepLinkScheme = resolveDeepLinkScheme(
      process.env.LLM_SPACE_DEEP_LINK_SCHEME
    );
    bindConstant(DESKTOP_DEEP_LINK_SOURCE, desktopDeepLinks);
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
    electrobun.default.events.on("before-quit", (event) =>
      handleBeforeQuit(
        event as import("./shutdown-coordinator").BeforeQuitEvent
      )
    );
    electrobun.default.events.on("reopen", () => {
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

/** Load and return every production child-Container registration stage. */
export async function createDesktopWindowComposition(): Promise<
  import("./desktop-window-factory").DesktopWindowComposition
> {
  const { analyticsRpcModule } = await import("../analytics/analytics-module");
  const { githubAccountRpcModule } =
    await import("../auth/github-account-module");
  const { auxiliaryGenerationRpcModule } =
    await import("../auxiliary-generation/auxiliary-generation-rpc-feature");
  const { builtinToolsRpcModule } = await import("../host/desktop-host-module");
  const { windowRegistryModule } = await import("../di/window-registry-module");
  const { mcpRpcModule } = await import("../mcp/mcp-module");
  const { modelsRpcModule } = await import("../models/models-rpc-feature");
  const { appDirectoriesRpcModule } =
    await import("../native/app-directories-module");
  const { nativeDialogsContributionsModule } =
    await import("../native/native-dialogs-module");
  const { nativeFilesRpcModule } =
    await import("../native/native-files-module");
  const { nativeWindowContributionsModule } =
    await import("../native/native-window-module");
  const { promptFilesRpcModule } =
    await import("../native/prompt-files-module");
  const { shellRpcModule } = await import("../native/shell-module");
  const { networkRpcModule } = await import("../network/network-module");
  const { playgroundContributionsModule, playgroundWindowModule } =
    await import("../playgrounds/playground-module");
  const { agentProjectsRpcModule } =
    await import("../projects/agent-projects-module");
  const { projectContributionsModule, projectWindowModule } =
    await import("../projects/project-module");
  const { remindersRpcModule } =
    await import("../reminders/reminders-rpc-feature");
  const { searchRpcModule } = await import("../search/search-module");
  const { skillsRpcModule } = await import("../skills/skills-module");
  const { threadSharingRpcModule } =
    await import("../thread-sharing/thread-sharing-rpc-feature");
  const { updatesRpcModule } = await import("../updates/updates-module");

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
