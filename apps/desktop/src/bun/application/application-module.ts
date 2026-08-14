import { ContainerModule, type ResolutionContext } from "inversify";

import {
  CommandContribution,
  type CommandContribution as CommandContributionApi,
} from "../di/command-contribution";
import type { CommandRegistry } from "../di/command-registry";
import type { DesktopWindowScope } from "../di/process-container";
import {
  RpcContribution,
  type RpcContribution as RpcContributionApi,
} from "../di/rpc-contribution";
import type { RpcRegistry } from "../di/rpc-registry";
import { desktopToken, PROCESS_TOKENS } from "../di/tokens";
import {
  AnalyticsRpcServer,
  GithubAccountRpcServer,
  RemindersRpcServer,
  ThreadSharingRpcServer,
  UpdatesRpcServer,
} from "../rpc/application-rpc-servers";

import {
  AnalyticsApplication,
  GithubAccountApplication,
  RemindersApplication,
  ThreadSharingApplication,
  UpdatesApplication,
} from "./application-services";
import { RUNTIME_APPLICATION_TOKENS } from "./runtime-module";

export const APPLICATION_TOKENS = {
  sharing: desktopToken<ThreadSharingApplication>(
    "thread-sharing",
    "application"
  ),
  github: desktopToken<GithubAccountApplication>(
    "github-account",
    "application"
  ),
  updates: desktopToken<UpdatesApplication>("updates", "application"),
  reminders: desktopToken<RemindersApplication>("reminders", "application"),
  analytics: desktopToken<AnalyticsApplication>("analytics", "application"),
} as const;

/** Register independent sharing, account, update, reminder, and analytics modules. */
export function applicationModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind<ThreadSharingApplication>(APPLICATION_TOKENS.sharing)
      .toDynamicValue(
        (context: ResolutionContext) =>
          new ThreadSharingApplication(
            context.get(RUNTIME_APPLICATION_TOKENS.workspace),
            context.get(RUNTIME_APPLICATION_TOKENS.models),
            context.get(PROCESS_TOKENS.gistWriter)
          )
      )
      .inSingletonScope();
    bind<GithubAccountApplication>(APPLICATION_TOKENS.github)
      .toDynamicValue(
        (context: ResolutionContext) =>
          new GithubAccountApplication(context.get(PROCESS_TOKENS.githubAuth))
      )
      .inSingletonScope();
    bind<UpdatesApplication>(APPLICATION_TOKENS.updates)
      .toDynamicValue(
        (context: ResolutionContext) =>
          new UpdatesApplication(context.get(PROCESS_TOKENS.updater))
      )
      .inSingletonScope();
    bind<RemindersApplication>(APPLICATION_TOKENS.reminders)
      .to(RemindersApplication)
      .inSingletonScope();
    bind<AnalyticsApplication>(APPLICATION_TOKENS.analytics)
      .toDynamicValue(
        (context: ResolutionContext) =>
          new AnalyticsApplication(context.get(PROCESS_TOKENS.analytics))
      )
      .inSingletonScope();
  });
}

class ThreadSharingContribution implements RpcContributionApi {
  constructor(private readonly _application: ThreadSharingApplication) {}

  /** Register thread sharing requests. */
  registerRpc(rpc: RpcRegistry): void {
    rpc.registerServer(new ThreadSharingRpcServer(this._application));
  }
}

class GithubAccountContribution
  implements CommandContributionApi, RpcContributionApi
{
  constructor(private readonly _application: GithubAccountApplication) {}

  /** Register GitHub account commands owned by the Bun process. */
  registerCommands(commands: CommandRegistry): void {
    commands.registerCommand("githubAccount.login", {
      execute: () => void this._application.login(),
    });
    commands.registerCommand("githubAccount.logout", {
      execute: () => this._application.logout(),
    });
  }

  /** Register GitHub account requests and state events. */
  registerRpc(rpc: RpcRegistry): void {
    rpc.registerServer(
      new GithubAccountRpcServer(this._application, this._application.events)
    );
  }
}

class UpdatesContribution
  implements CommandContributionApi, RpcContributionApi
{
  constructor(private readonly _application: UpdatesApplication) {}

  /** Register update lifecycle commands. */
  registerCommands(commands: CommandRegistry): void {
    commands.registerCommand("updates.check", {
      execute: () => void this._application.check(),
    });
    commands.registerCommand("updates.applyAndRestart", {
      execute: () => void this._application.applyAndRestart(),
    });
  }

  /** Register update requests and status events. */
  registerRpc(rpc: RpcRegistry): void {
    rpc.registerServer(
      new UpdatesRpcServer(this._application, this._application.events)
    );
  }
}

class RemindersContribution implements RpcContributionApi {
  constructor(private readonly _application: RemindersApplication) {}

  /** Register persisted feature reminder requests. */
  registerRpc(rpc: RpcRegistry): void {
    rpc.registerServer(new RemindersRpcServer(this._application));
  }
}

class AnalyticsContribution implements RpcContributionApi {
  constructor(private readonly _application: AnalyticsApplication) {}

  /** Register renderer analytics requests. */
  registerRpc(rpc: RpcRegistry): void {
    rpc.registerServer(new AnalyticsRpcServer(this._application));
  }
}

/** Bind general application adapters as window-scoped contributions. */
export function applicationContributionsModule(
  scope: DesktopWindowScope
): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(ThreadSharingContribution)
      .toDynamicValue(
        () =>
          new ThreadSharingContribution(scope.get(APPLICATION_TOKENS.sharing))
      )
      .inSingletonScope();
    bind(GithubAccountContribution)
      .toDynamicValue(
        () =>
          new GithubAccountContribution(scope.get(APPLICATION_TOKENS.github))
      )
      .inSingletonScope();
    bind(UpdatesContribution)
      .toDynamicValue(
        () => new UpdatesContribution(scope.get(APPLICATION_TOKENS.updates))
      )
      .inSingletonScope();
    bind(RemindersContribution)
      .toDynamicValue(
        () => new RemindersContribution(scope.get(APPLICATION_TOKENS.reminders))
      )
      .inSingletonScope();
    bind(AnalyticsContribution)
      .toDynamicValue(
        () => new AnalyticsContribution(scope.get(APPLICATION_TOKENS.analytics))
      )
      .inSingletonScope();

    bind<RpcContributionApi>(RpcContribution).toService(
      ThreadSharingContribution
    );
    bind<CommandContributionApi>(CommandContribution).toService(
      GithubAccountContribution
    );
    bind<RpcContributionApi>(RpcContribution).toService(
      GithubAccountContribution
    );
    bind<CommandContributionApi>(CommandContribution).toService(
      UpdatesContribution
    );
    bind<RpcContributionApi>(RpcContribution).toService(UpdatesContribution);
    bind<RpcContributionApi>(RpcContribution).toService(RemindersContribution);
    bind<RpcContributionApi>(RpcContribution).toService(AnalyticsContribution);
  });
}
