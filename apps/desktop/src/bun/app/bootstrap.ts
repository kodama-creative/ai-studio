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

  const { createDesktopProcessContainer } = await import(
    "../di/process-container"
  );
  const { DesktopLifecycle } = await import("./desktop-lifecycle");
  const processContainer = createDesktopProcessContainer();

  try {
    const { ContainerModule } = await import("inversify");
    const { getLlmSpaceHomePath } = await import("@llm-space/core/server");
    const { GistThreadReader, GistThreadWriter } = await import(
      "@llm-space/core/storage"
    );
    const { McpManager } = await import("@llm-space/runtime/mcp");
    const { createConfiguredArkImageGenerator, ModelManager } = await import(
      "@llm-space/runtime/models"
    );
    const { NetworkSettingsManager } = await import(
      "@llm-space/runtime/network"
    );
    const { SearchSettingsManager } = await import(
      "@llm-space/runtime/search"
    );
    const { SkillsManager } = await import("@llm-space/runtime/skills");
    const { createBuiltInToolsModule } = await import(
      "@llm-space/runtime/tools/built-in"
    );
    const { Utils } = await import("electrobun/bun");
    const { resolveDeepLinkScheme } = await import(
      "../../shared/deep-link-scheme"
    );
    const { Analytics } = await import("../analytics");
    const { ANALYTICS } = await import("../analytics/analytics-module");
    const { GITHUB_AUTH } = await import("../auth/github-account-module");
    const { GitHubAuthManager } = await import("../auth/github-auth-manager");
    const { auxiliaryGenerationModule } = await import(
      "../auxiliary-generation/auxiliary-generation-module"
    );
    const { activateWindowForDeepLink } = await import(
      "../deep-link/activate-window"
    );
    const { openPath, revealInFileManager } = await import("../fs");
    const { DesktopHost } = await import("../host/desktop-host");
    const { DESKTOP_HOST } = await import("../host/desktop-host-module");
    const { MCP_MANAGER } = await import("../mcp/mcp-module");
    const { MODEL_MANAGER, modelsModule } = await import(
      "../models/models-module"
    );
    const { APP_HOME_PATH } = await import("../native/app-directories-module");
    const { nativeDialogsApplicationModule } = await import(
      "../native/native-dialogs-module"
    );
    const { WINDOW_STATE_MANAGER } = await import(
      "../native/native-window-module"
    );
    const { NETWORK_SETTINGS } = await import("../network/network-module");
    const {
      PLAYGROUND_APPLICATION,
      playgroundModule,
    } = await import("../playgrounds/playground-module");
    const {
      agentProjectsModule,
      PROJECT_WINDOW_MANAGER,
    } = await import("../projects/agent-projects-module");
    const { ProjectWindowManager } = await import(
      "../projects/project-window-manager"
    );
    const { FileAgentProjectCatalogStore, FileProjectWindowStateStore } =
      await import("../projects/project-window-state");
    const { remindersModule } = await import("../reminders/reminders-module");
    const { SEARCH_SETTINGS } = await import("../search/search-module");
    const { SKILLS_MANAGER } = await import("../skills/skills-module");
    const {
      GIST_THREAD_READER,
      GIST_THREAD_WRITER,
      threadSharingModule,
    } = await import("../thread-sharing/thread-sharing-module");
    const { UpdaterService } = await import("../updates");
    const { UpdatesState } = await import("../updates/state");
    const { UPDATER } = await import("../updates/updates-module");
    const { DesktopApp } = await import("./desktop-app");
    const { DesktopLaunchController } = await import(
      "./desktop-launch-controller"
    );
    const { DesktopWindowFactory } = await import("./desktop-window-factory");
    const { MainWindowManager } = await import("./main-window-manager");
    const { WindowStateManager } = await import("./window-state");

    const processLifecycle = new DesktopLifecycle();
    processContainer.onDispose(() => processLifecycle.stop());
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
    processContainer.bindConstant(GITHUB_AUTH, githubAuth);
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
    processContainer.bindConstant(ANALYTICS, analytics);
    processContainer.bindConstant(APP_HOME_PATH, homePath);
    processContainer.bindConstant(DESKTOP_HOST, host);
    processContainer.bindConstant(GIST_THREAD_READER, gistReader);
    processContainer.bindConstant(GIST_THREAD_WRITER, gistWriter);
    processContainer.bindConstant(MCP_MANAGER, mcpManager);
    processContainer.bindConstant(MODEL_MANAGER, modelManager);
    processContainer.bindConstant(NETWORK_SETTINGS, networkSettings);
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
    // Eager adoption prevents a window from becoming the first owner of it.
    processContainer.get(PLAYGROUND_APPLICATION);

    const windowComposition = await createDesktopWindowScopeComposition();

    const windowFactory = new DesktopWindowFactory(
      processContainer,
      homePath,
      windowComposition
    );
    const projectWindows = new ProjectWindowManager({
      state: new FileProjectWindowStateStore(homePath),
      catalog: new FileAgentProjectCatalogStore(homePath),
      windows: windowFactory,
    });
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

    processContainer.bindConstant(PROJECT_WINDOW_MANAGER, projectWindows);
    processContainer.bindConstant(DesktopWindowFactory, windowFactory);
    processContainer.bindConstant(MainWindowManager, mainWindows);
    processContainer.bindConstant(DesktopLaunchController, launch);

    // DesktopApp is deliberately the final registration and lifecycle root.
    processContainer.load(
      new ContainerModule(({ bind }) => {
        bind(DesktopApp)
          .toDynamicValue(
            (context) =>
              new DesktopApp({
                analytics: context.get(ANALYTICS),
                updater: context.get(UPDATER),
                launch: context.get(DesktopLaunchController),
                mainWindows: context.get<typeof mainWindows>(MainWindowManager),
                projectWindows: context.get(PROJECT_WINDOW_MANAGER),
                windowFactory: context.get(DesktopWindowFactory),
                stopProcess: () => processContainer.dispose(),
              })
          )
          .inSingletonScope();
      })
    );
    await processContainer.get(DesktopApp).start();
  } catch (error) {
    const startupFailure = new DesktopLifecycle();
    startupFailure.defer("desktop process scope after startup failure", () =>
      processContainer.dispose()
    );
    await startupFailure.stop();
    throw error;
  }
}

/** Load and return every production window-scope registration stage. */
export async function createDesktopWindowScopeComposition(): Promise<
  import("./desktop-window-factory").DesktopWindowScopeComposition
> {
  const { analyticsRpcModule } = await import(
    "../analytics/analytics-module"
  );
  const { githubAccountRpcModule } = await import(
    "../auth/github-account-module"
  );
  const { auxiliaryGenerationRpcModule } = await import(
    "../auxiliary-generation/auxiliary-generation-rpc-feature"
  );
  const { builtinToolsRpcModule } = await import("../host/desktop-host-module");
  const { windowRegistryModule } = await import(
    "../di/window-registry-module"
  );
  const { mcpRpcModule } = await import("../mcp/mcp-module");
  const { modelsRpcModule } = await import("../models/models-rpc-feature");
  const { appDirectoriesRpcModule } = await import(
    "../native/app-directories-module"
  );
  const { nativeDialogsContributionsModule } = await import(
    "../native/native-dialogs-module"
  );
  const { nativeFilesRpcModule } = await import("../native/native-files-module");
  const { nativeWindowContributionsModule } = await import(
    "../native/native-window-module"
  );
  const { promptFilesRpcModule } = await import(
    "../native/prompt-files-module"
  );
  const { shellCommandsModule } = await import("../native/shell-module");
  const { networkRpcModule } = await import("../network/network-module");
  const { playgroundContributionsModule, playgroundWindowModule } =
    await import("../playgrounds/playground-module");
  const { agentProjectsCommandModule, agentProjectsRpcModule } = await import(
    "../projects/agent-projects-module"
  );
  const {
    projectContributionsModule,
    projectWindowIdentityModule,
    projectWindowModule,
  } = await import("../projects/project-module");
  const { remindersRpcModule } = await import(
    "../reminders/reminders-rpc-feature"
  );
  const { searchRpcModule } = await import("../search/search-module");
  const { skillsRpcModule } = await import("../skills/skills-module");
  const { threadSharingRpcModule } = await import(
    "../thread-sharing/thread-sharing-rpc-feature"
  );
  const { updatesRpcModule } = await import("../updates/updates-module");

  return {
    /** Register Main identity before its runtime contributions resolve. */
    configureMainIdentity(scope): void {
      scope.load(playgroundWindowModule());
    },

    /** Register Project source services before Studio is resolved. */
    configureProjectSource(scope, project): void {
      scope.load(projectWindowModule({ source: project }));
    },

    /** Register immutable Project identity after Studio source resolution. */
    configureProjectIdentity(scope, projectView): void {
      scope.load(projectWindowIdentityModule(projectView));
    },

    /** Register business contributions and infrastructure before snapshots. */
    configureRuntime(scope, { kind, commandSink, rpcEventSink }): void {
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
      scope.load(windowRegistryModule(scope, { commandSink, rpcEventSink }));
    },
  };
}
