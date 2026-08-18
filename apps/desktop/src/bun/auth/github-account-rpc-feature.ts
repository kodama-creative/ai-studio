import { ContainerModule, inject, injectable } from "inversify";

import {
  GITHUB_ACCOUNT_RPC,
  type GithubAccountRequests,
  type GithubAccountRpc,
} from "../../shared/github-account-rpc";
import {
  RpcContribution,
  type RpcContribution as RpcContributionApi,
} from "../di/rpc-contribution";
import type { RpcRegistry } from "../di/rpc-registry";

import { GitHubAuthManager } from "./github-auth-manager";

@injectable()
class GithubAccountContribution implements RpcContributionApi {
  constructor(
    @inject(GitHubAuthManager) private readonly _auth: GitHubAuthManager
  ) {}

  registerRpc(rpc: RpcRegistry): void {
    const requests: GithubAccountRequests = {
      getState: () => Promise.resolve(this._auth.getState()),
      signIn: () => this._auth.signIn(),
      signOut: () => Promise.resolve(this._auth.signOut()),
    };
    rpc.registerServer({
      namespace: GITHUB_ACCOUNT_RPC,
      requests,
      streams: {},
      eventSource: this._auth.events,
    } satisfies import("../../shared/namespaced-rpc").RpcServer<GithubAccountRpc>);
  }
}

/** Bind GitHub account commands and RPC as one shared contribution instance. */
export function githubAccountRpcModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(GithubAccountContribution).toSelf().inSingletonScope();
    bind<RpcContributionApi>(RpcContribution).toService(
      GithubAccountContribution
    );
  });
}
