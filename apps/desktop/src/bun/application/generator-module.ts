import { ContainerModule, type ResolutionContext } from "inversify";

import {
  RpcContribution,
  type RpcContribution as RpcContributionApi,
} from "../di/rpc-contribution";
import type { RpcRegistry } from "../di/rpc-registry";
import { desktopToken } from "../di/tokens";
import { GeneratorRpcServer } from "../rpc/generator-rpc-server";

import type { ModelsApplication } from "./models-application";
import { MODELS_APPLICATION } from "./models-module";
import type { NativeDialogApplication } from "./native-applications";
import { NATIVE_APPLICATION_TOKENS } from "./native-module";
import {
  ProjectGeneratorApplication,
  type ProjectGeneratorApplicationApi,
} from "./project-generator-application";

export const GENERATOR_APPLICATION =
  desktopToken<ProjectGeneratorApplicationApi>("generator", "application");

/** Register the process-scoped Generator application and its RPC adapter. */
export function generatorModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind<ProjectGeneratorApplicationApi>(GENERATOR_APPLICATION)
      .toDynamicValue(
        (context: ResolutionContext) =>
          new ProjectGeneratorApplication(
            context.get<NativeDialogApplication>(
              NATIVE_APPLICATION_TOKENS.dialogs
            ),
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
