import { ContainerModule, type ResolutionContext } from "inversify";

import {
  APP_DIRECTORIES_RPC,
  type AppDirectoriesRpc,
} from "../../shared/app-directories-rpc";
import type { RpcServer } from "../../shared/namespaced-rpc";
import {
  RpcContribution,
  type RpcContribution as RpcContributionApi,
} from "../di/rpc-contribution";
import type { RpcRegistry } from "../di/rpc-registry";
import { desktopToken, PROCESS_TOKENS } from "../di/tokens";
import { ensureRootDir } from "../fs/ensure-root-dir";

export const APP_DIRECTORIES_APPLICATION =
  desktopToken<AppDirectoriesApplication>("app-directories", "application");

export class AppDirectoriesApplication {
  constructor(private readonly _homePath: string) {}

  ensure(relativePath: string) {
    return Promise.resolve(ensureRootDir(this._homePath, relativePath));
  }
}

class AppDirectoriesRpcServer implements RpcServer<AppDirectoriesRpc> {
  readonly namespace = APP_DIRECTORIES_RPC;
  readonly streams = {};

  constructor(readonly requests: AppDirectoriesApplication) {}
}

class AppDirectoriesContribution implements RpcContributionApi {
  constructor(private readonly _application: AppDirectoriesApplication) {}

  registerRpc(rpc: RpcRegistry): void {
    rpc.registerServer(new AppDirectoriesRpcServer(this._application));
  }
}

/** Bind the process-owned application-directory module. */
export function appDirectoriesApplicationModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind<AppDirectoriesApplication>(APP_DIRECTORIES_APPLICATION)
      .toDynamicValue(
        (context: ResolutionContext) =>
          new AppDirectoriesApplication(
            context.get(PROCESS_TOKENS.homePath)
          )
      )
      .inSingletonScope();
  });
}

/** Bind app directory RPC for one window. */
export function appDirectoriesRpcModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(AppDirectoriesContribution)
      .toDynamicValue(
        (context) =>
          new AppDirectoriesContribution(
            context.get(APP_DIRECTORIES_APPLICATION)
          )
      )
      .inSingletonScope();
    bind<RpcContributionApi>(RpcContribution).toService(
      AppDirectoriesContribution
    );
  });
}
