import { ContainerModule, type ResolutionContext } from "inversify";

import {
  APP_DIRECTORIES_RPC,
  type AppDirectoriesRequests,
  type AppDirectoriesRpc,
} from "../../shared/app-directories-rpc";
import type { RpcServer } from "../../shared/namespaced-rpc";
import {
  RpcContribution,
  type RpcContribution as RpcContributionApi,
} from "../di/rpc-contribution";
import type { RpcRegistry } from "../di/rpc-registry";
import { desktopToken } from "../di/tokens";
import { bindWindowFeature, windowFeature } from "../di/window-feature";
import { ensureRootDir } from "../fs/ensure-root-dir";

export const APP_HOME_PATH = desktopToken<string>("app-directories", "home");

/** Typed Electrobun adapter for the app-directories namespace. */
class AppDirectoriesRpcServer implements RpcServer<AppDirectoriesRpc> {
  readonly namespace = APP_DIRECTORIES_RPC;
  readonly streams = {};
  readonly requests: AppDirectoriesRequests;

  constructor(homePath: string) {
    this.requests = {
      ensure: (relativePath) =>
        Promise.resolve(ensureRootDir(homePath, relativePath)),
    };
  }
}

/** Owns app-directories RPC registration for one native window. */
class AppDirectoriesContribution implements RpcContributionApi {
  private readonly _server: AppDirectoriesRpcServer;

  constructor(homePath: string) {
    this._server = new AppDirectoriesRpcServer(homePath);
  }

  registerRpc(rpc: RpcRegistry): void {
    rpc.registerServer(this._server);
  }
}

/** Bind app directory RPC for one window. */
export function appDirectoriesRpcModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(AppDirectoriesContribution)
      .toDynamicValue(
        (context: ResolutionContext) =>
          new AppDirectoriesContribution(context.get(APP_HOME_PATH))
      )
      .inSingletonScope();
    bind<RpcContributionApi>(RpcContribution).toService(
      AppDirectoriesContribution
    );
  });
}

/** Register app-owned directory operations as one bundled window feature. */
export function appDirectoriesModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bindWindowFeature(
      bind,
      windowFeature("app-directories", (scope) =>
        scope.load(appDirectoriesRpcModule())
      )
    );
  });
}
