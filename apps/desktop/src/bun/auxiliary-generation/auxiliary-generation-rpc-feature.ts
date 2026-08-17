import { ContainerModule, inject, injectable } from "inversify";

import {
  AUXILIARY_GENERATION_RPC,
  type AuxiliaryGenerationRpc,
} from "../../shared/auxiliary-generation-rpc";
import {
  RpcContribution,
  type RpcContribution as RpcContributionApi,
} from "../di/rpc-contribution";
import type { RpcRegistry } from "../di/rpc-registry";

import { AuxiliaryGenerationApplication } from "./auxiliary-generation-application";

@injectable()
class AuxiliaryGenerationRpcContribution implements RpcContributionApi {
  constructor(
    @inject(AuxiliaryGenerationApplication)
    private readonly _application: AuxiliaryGenerationApplication
  ) {}

  registerRpc(rpc: RpcRegistry): void {
    rpc.registerServer({
      namespace: AUXILIARY_GENERATION_RPC,
      requests: {},
      streams: this._application,
    } satisfies import("../../shared/namespaced-rpc").RpcServer<AuxiliaryGenerationRpc>);
  }
}

/** Bind auxiliary model generation as one window RPC contribution. */
export function auxiliaryGenerationRpcModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(AuxiliaryGenerationRpcContribution).toSelf().inSingletonScope();
    bind<RpcContributionApi>(RpcContribution).toService(
      AuxiliaryGenerationRpcContribution
    );
  });
}
