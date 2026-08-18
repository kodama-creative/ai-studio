import path from "node:path";

import { getLlmSpaceHomePath } from "@llm-space/core/server";
import Electrobun, { app } from "electrobun/bun";
import { Container } from "inversify";

import { resolveDeepLinkScheme } from "../../shared/deep-link-scheme";
import { analyticsModule } from "../analytics/analytics-module";
import { analyticsRpcModule } from "../analytics/analytics-rpc-feature";
import { githubAccountRpcModule } from "../auth/github-account-rpc-feature";
import { githubAuthModule } from "../auth/github-auth-module";
import { auxiliaryGenerationModule } from "../auxiliary-generation/auxiliary-generation-module";
import { auxiliaryGenerationRpcModule } from "../auxiliary-generation/auxiliary-generation-rpc-feature";
import type { DeepLinkSource } from "../deep-link/deep-link-inbox";
import { windowRegistryModule } from "../di/window-registry-module";
import { mcpModule } from "../mcp/mcp-module";
import { mcpRpcModule } from "../mcp/mcp-rpc-feature";
import { modelsModule } from "../models/models-module";
import { modelsRpcModule } from "../models/models-rpc-feature";
import { appDirectoriesRpcModule } from "../native/app-directories-module";
import {
  nativeDialogsApplicationModule,
  nativeDialogsContributionsModule,
} from "../native/native-dialogs-module";
import { nativeFilesModule } from "../native/native-files-module";
import { nativeFilesRpcModule } from "../native/native-files-rpc-feature";
import { nativeWindowContributionsModule } from "../native/native-window-module";
import { promptFilesRpcModule } from "../native/prompt-files-module";
import { shellRpcModule } from "../native/shell-module";
import { networkModule } from "../network/network-module";
import { networkRpcModule } from "../network/network-rpc-feature";
import {
  playgroundContributionsModule,
  playgroundModule,
  playgroundWindowModule,
} from "../playgrounds/playground-module";
import { agentProjectsModule } from "../projects/agent-projects-module";
import { agentProjectsRpcModule } from "../projects/agent-projects-rpc-feature";
import {
  projectContributionsModule,
  projectWindowModule,
} from "../projects/project-module";
import { remindersModule } from "../reminders/reminders-module";
import { remindersRpcModule } from "../reminders/reminders-rpc-feature";
import { searchModule } from "../search/search-module";
import { searchRpcModule } from "../search/search-rpc-feature";
import { seedSkills } from "../skills/seed";
import { skillsModule } from "../skills/skills-module";
import { skillsRpcModule } from "../skills/skills-rpc-feature";
import { threadSharingModule } from "../thread-sharing/thread-sharing-module";
import { threadSharingRpcModule } from "../thread-sharing/thread-sharing-rpc-feature";
import { builtInToolsModule } from "../tools/built-in-tools-module";
import { builtInToolsRpcModule } from "../tools/built-in-tools-rpc-feature";
import { updatesModule } from "../updates/updates-module";
import { updatesRpcModule } from "../updates/updates-rpc-feature";
import { seedWorkspace } from "../workspace/seed";

import { DesktopApp } from "./desktop-app";
import { desktopAppModule } from "./desktop-app-module";
import { desktopLaunchModule } from "./desktop-launch-module";
import {
  DESKTOP_DEEP_LINK_SCHEME,
  DESKTOP_DEEP_LINK_SOURCE,
} from "./desktop-launch-service";
import {
  APP_HOME_PATH,
  DESKTOP_ENV,
  WORKSPACE_ROOT,
} from "./desktop-paths";
import {
  DESKTOP_CONTAINER,
  DESKTOP_WINDOW_COMPOSITION,
  type DesktopWindowComposition,
} from "./desktop-window-factory";
import { desktopWindowModule } from "./desktop-window-module";
import { registerMenuActions } from "./menu";
import {
  type BeforeQuitEvent,
  createShutdownCoordinator,
} from "./shutdown-coordinator";

/** Compose, start, and connect the one production Desktop process scope. */
export async function bootstrapDesktopApp(
  deepLinks: DeepLinkSource
): Promise<void> {
  seedWorkspace();
  seedSkills();

  const container = new Container();
  let application: DesktopApp | undefined;
  let stopPromise: Promise<void> | undefined;
  const stopProcess = (): Promise<void> => {
    return (stopPromise ??= _stopProcess(container, application));
  };

  try {
    const homePath = getLlmSpaceHomePath();
    container.bind(APP_HOME_PATH).toConstantValue(homePath);
    container
      .bind(WORKSPACE_ROOT)
      .toConstantValue(path.join(homePath, "workspace"));
    container.bind(DESKTOP_ENV).toConstantValue(process.env);
    container.bind(DESKTOP_DEEP_LINK_SOURCE).toConstantValue(deepLinks);
    container
      .bind(DESKTOP_DEEP_LINK_SCHEME)
      .toConstantValue(
        resolveDeepLinkScheme(process.env.LLM_SPACE_DEEP_LINK_SCHEME)
      );
    container.bind(DESKTOP_CONTAINER).toConstantValue(container);
    container
      .bind(DESKTOP_WINDOW_COMPOSITION)
      .toConstantValue(_createWindowComposition());

    container.load(
      analyticsModule(),
      githubAuthModule(),
      networkModule(),
      modelsModule(),
      searchModule(),
      skillsModule(),
      mcpModule(),
      nativeFilesModule(),
      builtInToolsModule(),
      nativeDialogsApplicationModule(),
      auxiliaryGenerationModule(),
      playgroundModule(),
      threadSharingModule(),
      remindersModule(),
      updatesModule(),
      agentProjectsModule(),
      desktopWindowModule(),
      desktopLaunchModule()
    );

    // Resolve exactly one process root after every feature binding is complete.
    container.load(desktopAppModule());
    application = container.get(DesktopApp);

    registerMenuActions(
      () => application?.currentMainWindow(),
      (command, window) => application?.executeCommand(command, window)
    );
    const handleBeforeQuit = createShutdownCoordinator({
      quit: () => app.quit(),
      stop: stopProcess,
    });
    Electrobun.events.on("before-quit", (event) =>
      handleBeforeQuit(event as BeforeQuitEvent)
    );
    Electrobun.events.on("reopen", () => application?.reopen());

    await application.start();
  } catch (error) {
    try {
      await stopProcess();
    } catch (cleanupError) {
      console.error("Failed to clean Desktop composition:", cleanupError);
    }
    throw error;
  }
}

/** Declare fresh module factories for Common, Main, and Project child scopes. */
function _createWindowComposition(): DesktopWindowComposition {
  return {
    common: [
      () => githubAccountRpcModule(),
      () => updatesRpcModule(),
      () => remindersRpcModule(),
      () => analyticsRpcModule(),
      () => nativeDialogsContributionsModule(),
      () => nativeFilesRpcModule(),
      () => appDirectoriesRpcModule(),
      () => nativeWindowContributionsModule(),
      () => shellRpcModule(),
      () => auxiliaryGenerationRpcModule(),
      () => modelsRpcModule(),
      () => promptFilesRpcModule(),
      () => mcpRpcModule(),
      () => builtInToolsRpcModule(),
      () => searchRpcModule(),
      () => networkRpcModule(),
      () => skillsRpcModule(),
      ({ rpcEventSink }) => windowRegistryModule({ rpcEventSink }),
    ],
    main: [
      () => playgroundWindowModule(),
      () => playgroundContributionsModule(),
      () => agentProjectsRpcModule(),
      () => threadSharingRpcModule(),
    ],
    project: [
      (project) => projectWindowModule({ source: project }),
      () => projectContributionsModule(),
    ],
  };
}

async function _stopProcess(
  container: Container,
  application: DesktopApp | undefined
): Promise<void> {
  const errors: unknown[] = [];
  if (application !== undefined) {
    try {
      await application.stop();
    } catch (error) {
      errors.push(error);
    }
  }
  try {
    await container.unbindAllAsync();
  } catch (error) {
    errors.push(error);
  }
  if (errors.length > 0) {
    throw new AggregateError(errors, "Failed to stop Desktop process.");
  }
}
