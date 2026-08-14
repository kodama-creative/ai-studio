import { ContainerModule, type ResolutionContext } from "inversify";

import {
  COMMAND_HANDLER_CONTRIBUTION,
  type CommandHandlerContribution,
} from "../di/command-contribution";
import {
  RPC_SERVER_CONTRIBUTION,
  type RpcServerContribution,
} from "../di/rpc-contribution";
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
  sharing: desktopToken<ThreadSharingApplication>("thread-sharing", "application"),
  github: desktopToken<GithubAccountApplication>("github-account", "application"),
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
    const contribute = (
      id: RpcServerContribution["id"],
      create: RpcServerContribution["create"]
    ) =>
      bind<RpcServerContribution>(RPC_SERVER_CONTRIBUTION).toConstantValue({
        id,
        windows: ["main", "project"],
        create,
      });
    contribute(
      "thread-sharing.rpc",
      (scope) =>
        new ThreadSharingRpcServer(scope.get(APPLICATION_TOKENS.sharing))
    );
    contribute("github-account.rpc", (scope) => {
      const app = scope.get<GithubAccountApplication>(
        APPLICATION_TOKENS.github
      );
      return new GithubAccountRpcServer(app, app.events);
    });
    contribute("updates.rpc", (scope) => {
      const app = scope.get<UpdatesApplication>(APPLICATION_TOKENS.updates);
      return new UpdatesRpcServer(app, app.events);
    });
    contribute(
      "reminders.rpc",
      (scope) => new RemindersRpcServer(scope.get(APPLICATION_TOKENS.reminders))
    );
    contribute(
      "analytics.rpc",
      (scope) => new AnalyticsRpcServer(scope.get(APPLICATION_TOKENS.analytics))
    );
    bind<CommandHandlerContribution>(
      COMMAND_HANDLER_CONTRIBUTION
    ).toConstantValue({
      id: "github-account.commands",
      windows: ["main", "project"],
      create: (scope) => {
        const github = scope.get<GithubAccountApplication>(
          APPLICATION_TOKENS.github
        );
        return {
          commands: ["githubAccount.login", "githubAccount.logout"],
          execute(command) {
            if (command.type === "githubAccount.login") void github.login();
            else if (command.type === "githubAccount.logout") github.logout();
          },
        };
      },
    });
    bind<CommandHandlerContribution>(
      COMMAND_HANDLER_CONTRIBUTION
    ).toConstantValue({
      id: "updates.commands",
      windows: ["main", "project"],
      create: (scope) => {
        const updates = scope.get<UpdatesApplication>(
          APPLICATION_TOKENS.updates
        );
        return {
          commands: ["updates.check", "updates.applyAndRestart"],
          execute(command) {
            if (command.type === "updates.check") void updates.check();
            else if (command.type === "updates.applyAndRestart") {
              void updates.applyAndRestart();
            }
          },
        };
      },
    });
  });
}
