import { ContainerModule } from "inversify";

import {
  AUXILIARY_GENERATION_RPC,
  type AuxiliaryGenerationRpc,
} from "../../shared/auxiliary-generation-rpc";
import type { RpcServer } from "../../shared/namespaced-rpc";
import type { AuxiliaryGenerationApplication } from "../application/auxiliary-generation-application";
import { AUXILIARY_GENERATION_APPLICATION } from "../application/auxiliary-generation-module";
import type { DesktopWindowScope } from "../di/process-container";
import {
  RpcContribution,
  type RpcContribution as RpcContributionApi,
} from "../di/rpc-contribution";
import type { RpcRegistry } from "../di/rpc-registry";

/** Typed Desktop RPC adapter for stateless UI helper generation. */
class AuxiliaryGenerationRpcServer
  implements RpcServer<AuxiliaryGenerationRpc>
{
  readonly namespace = AUXILIARY_GENERATION_RPC;
  readonly requests = {};
  readonly streams: AuxiliaryGenerationRpc["streams"];

  constructor(application: AuxiliaryGenerationApplication) {
    this.streams = application;
  }
}

class AuxiliaryGenerationRpcContribution implements RpcContributionApi {
  constructor(private readonly _application: AuxiliaryGenerationApplication) {}

  registerRpc(rpc: RpcRegistry): void {
    rpc.registerServer(new AuxiliaryGenerationRpcServer(this._application));
  }
}

/** Bind auxiliary model generation as one window RPC contribution. */
export function auxiliaryGenerationRpcModule(
  scope: DesktopWindowScope
): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(AuxiliaryGenerationRpcContribution)
      .toDynamicValue(
        () =>
          new AuxiliaryGenerationRpcContribution(
            scope.get(AUXILIARY_GENERATION_APPLICATION)
          )
      )
      .inSingletonScope();
    bind<RpcContributionApi>(RpcContribution).toService(
      AuxiliaryGenerationRpcContribution
    );
  });
}
