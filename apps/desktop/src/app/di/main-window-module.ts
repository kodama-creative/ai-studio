import { ContainerModule } from "inversify";

import {
  ANALYTICS_RPC,
  ANALYTICS_SERVICE,
  type AnalyticsRequests,
} from "@/shared/analytics-rpc";
import {
  createRpcClient,
  type RpcClientTransport,
} from "@/shared/namespaced-rpc";
import {
  PLAYGROUND_RPC,
  PLAYGROUND_SERVICE,
  type PlaygroundClient,
} from "@/shared/playground-rpc";
import {
  REMINDERS_RPC,
  REMINDERS_SERVICE,
  type RemindersRequests,
} from "@/shared/reminders-rpc";
import {
  THREAD_SHARING_RPC,
  THREAD_SHARING_SERVICE,
  type ThreadSharingRequests,
} from "@/shared/thread-sharing-rpc";

import { GithubAuthController } from "../account/github-auth-controller";
import { DesktopSeedHost } from "../playground/desktop-seed-host";
import { PaneActivityTracker } from "../playground/pane-activity-tracker";
import { PlaygroundWorkspaceController } from "../playground/playground-workspace-controller";
import { AgentProjectCatalogController } from "../project/agent-project-catalog-controller";
import { RemindersController } from "../reminders/reminders-controller";
import { MainTabsActivityService } from "../tabs/main-tabs-activity";
import {
  MAIN_TABS_ACTIVITY,
  MAIN_TABS_PERSISTENCE,
  MainTabsController,
} from "../tabs/main-tabs-controller";
import { MainTabsLocalStorage } from "../tabs/main-tabs-local-storage";
import { UpdateStatusController } from "../updates/update-status-controller";

import { RENDERER_LIFECYCLE_CONTRIBUTION } from "./lifecycle";
export function rendererMainWindowModule(
  transport: RpcClientTransport
): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind<PlaygroundClient>(PLAYGROUND_SERVICE).toConstantValue(
      createRpcClient(PLAYGROUND_RPC, transport)
    );
    bind<AnalyticsRequests>(ANALYTICS_SERVICE).toConstantValue(
      createRpcClient(ANALYTICS_RPC, transport)
    );
    bind<RemindersRequests>(REMINDERS_SERVICE).toConstantValue(
      createRpcClient(REMINDERS_RPC, transport)
    );
    bind<ThreadSharingRequests>(THREAD_SHARING_SERVICE).toConstantValue(
      createRpcClient(THREAD_SHARING_RPC, transport)
    );
    bind(DesktopSeedHost).toSelf().inSingletonScope();

    bind(PaneActivityTracker).toSelf().inSingletonScope();
    bind(MainTabsActivityService).toSelf().inSingletonScope();
    bind(MAIN_TABS_ACTIVITY).toService(MainTabsActivityService);
    bind(MainTabsLocalStorage).toSelf().inSingletonScope();
    bind(MAIN_TABS_PERSISTENCE).toService(MainTabsLocalStorage);
    bind(MainTabsController).toSelf().inSingletonScope();
    bind(RENDERER_LIFECYCLE_CONTRIBUTION).toService(MainTabsController);

    bind(PlaygroundWorkspaceController).toSelf().inSingletonScope();
    bind(RENDERER_LIFECYCLE_CONTRIBUTION).toService(
      PlaygroundWorkspaceController
    );

    bind(AgentProjectCatalogController).toSelf().inSingletonScope();
    bind(RENDERER_LIFECYCLE_CONTRIBUTION).toService(
      AgentProjectCatalogController
    );

    bind(GithubAuthController).toSelf().inSingletonScope();
    bind(RENDERER_LIFECYCLE_CONTRIBUTION).toService(GithubAuthController);

    bind(RemindersController).toSelf().inSingletonScope();
    bind(RENDERER_LIFECYCLE_CONTRIBUTION).toService(RemindersController);

    bind(UpdateStatusController).toSelf().inSingletonScope();
    bind(RENDERER_LIFECYCLE_CONTRIBUTION).toService(UpdateStatusController);
  });
}
