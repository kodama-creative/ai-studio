import { ContainerModule } from "inversify";

import {
  GITHUB_ACCOUNT_RPC,
  type GithubAccountRequests,
  type GithubAccountRpc,
} from "../../shared/github-account-rpc";
import type { RpcServer } from "../../shared/namespaced-rpc";
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
import { desktopToken } from "../di/tokens";

import type { GitHubAuthManager } from "./github-auth-manager";

export const GITHUB_AUTH = desktopToken<GitHubAuthManager>(
  "github-account",
  "auth"
);

class GithubAccountRpcServer implements RpcServer<GithubAccountRpc> {
  readonly namespace = GITHUB_ACCOUNT_RPC;
  readonly streams = {};
  readonly eventSource;
  readonly requests: GithubAccountRequests;

  constructor(auth: GitHubAuthManager) {
    this.requests = {
      getState: () => Promise.resolve(auth.getState()),
    };
    this.eventSource = auth.events;
  }
}

class GithubAccountContribution
  implements CommandContributionApi, RpcContributionApi
{
  constructor(private readonly _auth: GitHubAuthManager) {}

  registerCommands(commands: CommandRegistry): void {
    commands.registerCommand("githubAccount.login", {
      execute: () => this._auth.signIn(),
    });
    commands.registerCommand("githubAccount.logout", {
      execute: () => this._auth.signOut(),
    });
  }

  registerRpc(rpc: RpcRegistry): void {
    rpc.registerServer(new GithubAccountRpcServer(this._auth));
  }
}

/** Bind GitHub account commands and RPC as one shared contribution instance. */
export function githubAccountRpcModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(GithubAccountContribution)
      .toDynamicValue(
        (context) =>
          new GithubAccountContribution(
            context.get<GitHubAuthManager>(GITHUB_AUTH)
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
