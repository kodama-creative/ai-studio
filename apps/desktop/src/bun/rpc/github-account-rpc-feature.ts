import { ContainerModule } from "inversify";

import {
  GITHUB_ACCOUNT_RPC,
  type GithubAccountRpc,
} from "../../shared/github-account-rpc";
import type { RpcServer } from "../../shared/namespaced-rpc";
import {
  GITHUB_ACCOUNT_APPLICATION,
  type GithubAccountApplication,
} from "../application/github-account-application";
import {
  CommandContribution,
  type CommandContribution as CommandContributionApi,
} from "../di/command-contribution";
import type { CommandRegistry } from "../di/command-registry";
import {
  RpcContribution,
  type RpcContribution as RpcContributionApi,
} from "../di/rpc-contribution";
import type { RpcRegistry } from "../di/rpc-registry";

class GithubAccountRpcServer implements RpcServer<GithubAccountRpc> {
  readonly namespace = GITHUB_ACCOUNT_RPC;
  readonly streams = {};
  readonly eventSource;

  constructor(readonly requests: GithubAccountApplication) {
    this.eventSource = requests.events;
  }
}

class GithubAccountContribution
  implements CommandContributionApi, RpcContributionApi
{
  constructor(private readonly _application: GithubAccountApplication) {}

  registerCommands(commands: CommandRegistry): void {
    commands.registerCommand("githubAccount.login", {
      execute: () => void this._application.login(),
    });
    commands.registerCommand("githubAccount.logout", {
      execute: () => this._application.logout(),
    });
  }

  registerRpc(rpc: RpcRegistry): void {
    rpc.registerServer(new GithubAccountRpcServer(this._application));
  }
}

/** Bind GitHub account commands and RPC as one shared contribution instance. */
export function githubAccountRpcModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(GithubAccountContribution)
      .toDynamicValue(
        (context) =>
          new GithubAccountContribution(
            context.get(GITHUB_ACCOUNT_APPLICATION)
          )
      )
      .inSingletonScope();
    bind<CommandContributionApi>(CommandContribution).toService(
      GithubAccountContribution
    );
    bind<RpcContributionApi>(RpcContribution).toService(
      GithubAccountContribution
    );
  });
}
