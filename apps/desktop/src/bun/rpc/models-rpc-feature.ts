import { ContainerModule } from "inversify";

import type { ModelsRequests, ModelsRpc } from "../../shared/models-rpc";
import { MODELS_RPC } from "../../shared/models-rpc";
import type { RpcServer } from "../../shared/namespaced-rpc";
import type { ModelsApplication } from "../application/models-application";
import { MODELS_APPLICATION } from "../application/models-module";
import {
  RpcContribution,
  type RpcContribution as RpcContributionApi,
} from "../di/rpc-contribution";
import type { RpcRegistry } from "../di/rpc-registry";

class ModelsRpcServer implements RpcServer<ModelsRpc> {
  readonly namespace = MODELS_RPC;
  readonly requests: ModelsRequests;
  readonly streams = {};

  constructor(application: ModelsApplication) {
    this.requests = application;
  }
}

/** Owns the Models namespace for one native window. */
class ModelsRpcContribution implements RpcContributionApi {
  constructor(private readonly _application: ModelsApplication) {}

  registerRpc(rpc: RpcRegistry): void {
    rpc.registerServer(new ModelsRpcServer(this._application));
  }
}

/** Bind Models use cases as one window RPC contribution. */
export function modelsRpcModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(ModelsRpcContribution)
      .toDynamicValue(
        (context) =>
          new ModelsRpcContribution(context.get(MODELS_APPLICATION))
      )
      .inSingletonScope();
    bind<RpcContributionApi>(RpcContribution).toService(ModelsRpcContribution);
  });
}
