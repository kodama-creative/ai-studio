import { ContainerModule, inject, injectable } from "inversify";

import type { Disposable } from "../../shared/disposable";
import type { ModelsRpc } from "../../shared/models-rpc";
import { MODELS_RPC } from "../../shared/models-rpc";
import {
  RpcContribution,
  type RpcContribution as RpcContributionApi,
} from "../di/rpc-contribution";
import type { RpcRegistry } from "../di/rpc-registry";

import { ModelsService } from "./models-service";

/** Owns the Models namespace for one native window. */
@injectable()
class ModelsRpcContribution implements RpcContributionApi {
  constructor(
    @inject(ModelsService) private readonly _application: ModelsService
  ) {}

  registerRpc(rpc: RpcRegistry): void {
    rpc.registerServer({
      namespace: MODELS_RPC,
      requests: this._application,
      streams: {},
      eventSource: {
        subscribe: (event, listener): Disposable => {
          if (event !== "changed") {
            throw new Error(`Unknown Models event: ${String(event)}`);
          }
          return this._application.onDidChange(() => listener({}));
        },
      },
    } satisfies import("../../shared/namespaced-rpc").RpcServer<ModelsRpc>);
  }
}

/** Bind Models use cases as one window RPC contribution. */
export function modelsRpcModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(ModelsRpcContribution).toSelf().inSingletonScope();
    bind<RpcContributionApi>(RpcContribution).toService(ModelsRpcContribution);
  });
}
