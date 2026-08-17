import { ContainerModule, inject, injectable } from "inversify";

import {
  APP_DIRECTORIES_RPC,
  type AppDirectoriesRequests,
  type AppDirectoriesRpc,
} from "../../shared/app-directories-rpc";
import {
  RpcContribution,
  type RpcContribution as RpcContributionApi,
} from "../di/rpc-contribution";
import type { RpcRegistry } from "../di/rpc-registry";
import { ensureRootDir } from "../fs/ensure-root-dir";

export const APP_HOME_PATH = Symbol("AppHomePath");

/** Owns app-directories RPC registration for one native window. */
@injectable()
class AppDirectoriesContribution implements RpcContributionApi {
  constructor(@inject(APP_HOME_PATH) private readonly _homePath: string) {}

  registerRpc(rpc: RpcRegistry): void {
    const requests: AppDirectoriesRequests = {
      ensure: (relativePath) =>
        Promise.resolve(ensureRootDir(this._homePath, relativePath)),
    };
    rpc.registerServer({
      namespace: APP_DIRECTORIES_RPC,
      requests,
      streams: {},
    } satisfies import("../../shared/namespaced-rpc").RpcServer<AppDirectoriesRpc>);
  }
}

/** Bind app directory RPC for one window. */
export function appDirectoriesRpcModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(AppDirectoriesContribution).toSelf().inSingletonScope();
    bind<RpcContributionApi>(RpcContribution).toService(
      AppDirectoriesContribution
    );
  });
}
