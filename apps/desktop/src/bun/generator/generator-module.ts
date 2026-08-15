import { ContainerModule, type ResolutionContext } from "inversify";

import { GENERATOR_RPC, type GeneratorRpc } from "../../shared/generator-rpc";
import type { RpcServer } from "../../shared/namespaced-rpc";
import type { ModelsApplication } from "../application/models-application";
import { MODELS_APPLICATION } from "../application/models-module";
import {
  RpcContribution,
  type RpcContribution as RpcContributionApi,
} from "../di/rpc-contribution";
import type { RpcRegistry } from "../di/rpc-registry";
import { desktopToken } from "../di/tokens";
import {
  NATIVE_DIALOGS_APPLICATION,
  type NativeDialogsApplication,
} from "../native/native-dialogs-module";

import {
  ProjectGeneratorApplication,
  type ProjectGeneratorApplicationApi,
} from "./project-generator-application";

export const GENERATOR_APPLICATION =
  desktopToken<ProjectGeneratorApplicationApi>("generator", "application");

class GeneratorRpcServer implements RpcServer<GeneratorRpc> {
  readonly namespace = GENERATOR_RPC;
  readonly streams = {};

  constructor(readonly requests: ProjectGeneratorApplicationApi) {}
}

/** Register the process-scoped Generator application and its RPC adapter. */
export function generatorModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind<ProjectGeneratorApplicationApi>(GENERATOR_APPLICATION)
      .toDynamicValue(
        (context: ResolutionContext) =>
          new ProjectGeneratorApplication(
            context.get<NativeDialogsApplication>(NATIVE_DIALOGS_APPLICATION),
            context.get<ModelsApplication>(MODELS_APPLICATION)
          )
      )
      .inSingletonScope();
  });
}

class GeneratorContribution implements RpcContributionApi {
  constructor(private readonly _application: ProjectGeneratorApplicationApi) {}

  /** Register the typed project generator RPC namespace. */
  registerRpc(rpc: RpcRegistry): void {
    rpc.registerServer(new GeneratorRpcServer(this._application));
  }
}

/** Bind one generator contribution inside the owning window scope. */
export function generatorContributionsModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(GeneratorContribution)
      .toDynamicValue(
        (context) =>
          new GeneratorContribution(context.get(GENERATOR_APPLICATION))
      )
      .inSingletonScope();
    bind<RpcContributionApi>(RpcContribution).toService(GeneratorContribution);
  });
}
