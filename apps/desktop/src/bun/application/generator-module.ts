import { ContainerModule, type ResolutionContext } from "inversify";

import type { DesktopWindowScope } from "../di/process-container";
import {
  RpcContribution,
  type RpcContribution as RpcContributionApi,
} from "../di/rpc-contribution";
import type { RpcRegistry } from "../di/rpc-registry";
import { desktopToken } from "../di/tokens";
import { GeneratorRpcServer } from "../rpc/generator-rpc-server";

import type { NativeDialogApplication } from "./native-applications";
import { NATIVE_APPLICATION_TOKENS } from "./native-module";
import {
  ProjectGeneratorApplication,
  type ProjectGeneratorApplicationApi,
} from "./project-generator-application";
import type { ModelsApplication } from "./runtime-applications";
import { RUNTIME_APPLICATION_TOKENS } from "./runtime-module";

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
            context.get<ModelsApplication>(RUNTIME_APPLICATION_TOKENS.models)
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
export function generatorContributionsModule(
  scope: DesktopWindowScope
): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(GeneratorContribution)
      .toDynamicValue(
        () => new GeneratorContribution(scope.get(GENERATOR_APPLICATION))
      )
      .inSingletonScope();
    bind<RpcContributionApi>(RpcContribution).toService(GeneratorContribution);
  });
}
