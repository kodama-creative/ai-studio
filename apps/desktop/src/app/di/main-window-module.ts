import type { SeedHost } from "@llm-space/ui/components/thread-playground/examples/prompts";
import { ContainerModule, type ResolutionContext } from "inversify";

import {
  createAgentProjectClient,
  type AgentProjectClient,
} from "@/client/agent-project-client";
import {
  createAnalyticsClient,
  type AnalyticsClient,
} from "@/client/analytics";
import { createGithubAccountClient } from "@/client/github-auth";
import {
  createPlaygroundClient,
  type PlaygroundClient,
} from "@/client/playground-client";
import { createRemindersClient } from "@/client/reminders";
import { createThreadSharingClient } from "@/client/share";

import { GithubAuthController } from "../account/github-auth-controller";
import { PaneActivityTracker } from "../playground/pane-activity-tracker";
import { PlaygroundWorkspaceController } from "../playground/playground-workspace-controller";
import { AgentProjectCatalogController } from "../project/agent-project-catalog-controller";
import { RemindersController } from "../reminders/reminders-controller";
import { MainTabsController } from "../tabs/main-tabs-controller";
import { MainTabsLocalStorage } from "../tabs/main-tabs-local-storage";
import { UpdateStatusController } from "../updates/update-status-controller";

import {
  APP_DIRECTORIES_CLIENT,
  RENDERER_COMMAND_REGISTRY,
  RENDERER_EVENTS,
  SKILLS_CLIENT,
  UPDATES_CLIENT,
} from "./common-module";
import { RENDERER_LIFECYCLE_CONTRIBUTION } from "./lifecycle";
import { rendererToken, resolveRenderer } from "./tokens";

export const PLAYGROUND_CLIENT = rendererToken<PlaygroundClient>(
  "playgrounds",
  "client"
);
export const AGENT_PROJECT_CLIENT = rendererToken<AgentProjectClient>(
  "agent-projects",
  "client"
);
export const ANALYTICS_CLIENT = rendererToken<AnalyticsClient>(
  "analytics",
  "client"
);
export const GITHUB_ACCOUNT_CLIENT = rendererToken<
  ReturnType<typeof createGithubAccountClient>
>("github-account", "client");
export const REMINDERS_CLIENT = rendererToken<
  ReturnType<typeof createRemindersClient>
>("reminders", "client");
export const THREAD_SHARING_CLIENT = rendererToken<
  ReturnType<typeof createThreadSharingClient>
>("thread-sharing", "client");
export const SEED_HOST = rendererToken<SeedHost>("playgrounds", "seed-host");
export const PANE_ACTIVITY_TRACKER = rendererToken<PaneActivityTracker>(
  "playgrounds",
  "pane-activity-tracker"
);
export const MAIN_TABS_CONTROLLER = rendererToken<MainTabsController>(
  "tabs",
  "main-controller"
);
export const PLAYGROUND_WORKSPACE_CONTROLLER =
  rendererToken<PlaygroundWorkspaceController>(
    "playgrounds",
    "workspace-controller"
  );
export const AGENT_PROJECT_CATALOG_CONTROLLER =
  rendererToken<AgentProjectCatalogController>(
    "agent-projects",
    "catalog-controller"
  );
export const GITHUB_AUTH_CONTROLLER = rendererToken<GithubAuthController>(
  "github-account",
  "controller"
);
export const REMINDERS_CONTROLLER = rendererToken<RemindersController>(
  "reminders",
  "controller"
);
export const UPDATE_STATUS_CONTROLLER = rendererToken<UpdateStatusController>(
  "updates",
  "status-controller"
);

export function rendererMainWindowModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(PLAYGROUND_CLIENT).toConstantValue(createPlaygroundClient());
    bind(AGENT_PROJECT_CLIENT).toConstantValue(createAgentProjectClient());
    bind(ANALYTICS_CLIENT).toConstantValue(createAnalyticsClient());
    bind(GITHUB_ACCOUNT_CLIENT).toConstantValue(createGithubAccountClient());
    bind(REMINDERS_CLIENT).toConstantValue(createRemindersClient());
    bind(THREAD_SHARING_CLIENT).toConstantValue(createThreadSharingClient());
    bind(SEED_HOST)
      .toDynamicValue((context: ResolutionContext): SeedHost => {
        const skills = resolveRenderer(context, SKILLS_CLIENT);
        const directories = resolveRenderer(context, APP_DIRECTORIES_CLIENT);
        return {
          skills: {
            getSettings: () => skills.getSettings(),
            listAvailable: () => skills.listAvailable(),
            listSkills: (path) => skills.list(path),
          },
          paths: { ensureRootDir: (path) => directories.ensure(path) },
        };
      })
      .inSingletonScope();

    bind(PANE_ACTIVITY_TRACKER)
      .toDynamicValue(() => new PaneActivityTracker())
      .inSingletonScope();
    bind(MAIN_TABS_CONTROLLER)
      .toDynamicValue((context: ResolutionContext) => {
        const playgrounds = resolveRenderer(context, PLAYGROUND_CLIENT);
        const tracker = resolveRenderer(context, PANE_ACTIVITY_TRACKER);
        return new MainTabsController({
          persistence: new MainTabsLocalStorage(),
          playgroundExists: (playgroundId) =>
            playgrounds.load(playgroundId).then((value) => value !== undefined),
          canPruneRestoredTab: (tab) =>
            !tracker.isPaneBusy(tab.paneId) &&
            !tracker.isMutationReserved(tab.paneId),
          subscribeToPruneChanges: tracker.subscribe,
        });
      })
      .inSingletonScope();
    bind(RENDERER_LIFECYCLE_CONTRIBUTION).toService(MAIN_TABS_CONTROLLER);

    bind(PLAYGROUND_WORKSPACE_CONTROLLER)
      .toDynamicValue((context: ResolutionContext) => {
        const tabs = resolveRenderer(context, MAIN_TABS_CONTROLLER);
        const events = resolveRenderer(context, RENDERER_EVENTS);
        const sharing = resolveRenderer(context, THREAD_SHARING_CLIENT);
        return new PlaygroundWorkspaceController({
          client: resolveRenderer(context, PLAYGROUND_CLIENT),
          importSnapshot: (snapshot) => sharing.importSnapshot(snapshot),
          seedHost: resolveRenderer(context, SEED_HOST),
          openPlayground: (playground) =>
            tabs.dispatch({
              type: "open",
              playgroundId: playground.id,
              title: playground.title,
            }),
          notifySuccess: (message) =>
            events.emit("notification:success", message),
          notifyError: (title, error) =>
            events.emit("notification:error", title, error),
        });
      })
      .inSingletonScope();
    bind(RENDERER_LIFECYCLE_CONTRIBUTION).toService(
      PLAYGROUND_WORKSPACE_CONTROLLER
    );

    bind(AGENT_PROJECT_CATALOG_CONTROLLER)
      .toDynamicValue((context: ResolutionContext) => {
        const events = resolveRenderer(context, RENDERER_EVENTS);
        return new AgentProjectCatalogController({
          client: resolveRenderer(context, AGENT_PROJECT_CLIENT),
          reportError: (title, error) =>
            events.emit("notification:error", title, error),
        });
      })
      .inSingletonScope();
    bind(RENDERER_LIFECYCLE_CONTRIBUTION).toService(
      AGENT_PROJECT_CATALOG_CONTROLLER
    );

    bind(GITHUB_AUTH_CONTROLLER)
      .toDynamicValue((context: ResolutionContext) => {
        const client = resolveRenderer(context, GITHUB_ACCOUNT_CLIENT);
        const commands = resolveRenderer(context, RENDERER_COMMAND_REGISTRY);
        const events = resolveRenderer(context, RENDERER_EVENTS);
        return new GithubAuthController({
          getState: () => client.getState(),
          subscribeChanged: (listener) => client.on("changed", listener),
          login: () =>
            commands.executeCommand({
              type: "githubAccount.login",
              args: {},
            }),
          logout: () =>
            commands.executeCommand({
              type: "githubAccount.logout",
              args: {},
            }),
          notifyError: (message) => events.emit("notification:error", message),
        });
      })
      .inSingletonScope();
    bind(RENDERER_LIFECYCLE_CONTRIBUTION).toService(GITHUB_AUTH_CONTROLLER);

    bind(REMINDERS_CONTROLLER)
      .toDynamicValue(
        (context: ResolutionContext) =>
          new RemindersController(resolveRenderer(context, REMINDERS_CLIENT))
      )
      .inSingletonScope();
    bind(RENDERER_LIFECYCLE_CONTRIBUTION).toService(REMINDERS_CONTROLLER);

    bind(UPDATE_STATUS_CONTROLLER)
      .toDynamicValue(
        (context: ResolutionContext) =>
          new UpdateStatusController(
            resolveRenderer(context, UPDATES_CLIENT),
            resolveRenderer(context, RENDERER_COMMAND_REGISTRY),
            resolveRenderer(context, RENDERER_EVENTS)
          )
      )
      .inSingletonScope();
    bind(RENDERER_LIFECYCLE_CONTRIBUTION).toService(UPDATE_STATUS_CONTROLLER);
  });
}
