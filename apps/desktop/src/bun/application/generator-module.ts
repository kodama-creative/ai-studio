import { ContainerModule, type ResolutionContext } from "inversify";

import {
  RPC_SERVER_CONTRIBUTION,
  type RpcServerContribution,
} from "../di/rpc-contribution";
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

export const GENERATOR_APPLICATION = desktopToken<ProjectGeneratorApplicationApi>(
  "generator",
  "application"
);

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
    bind<RpcServerContribution>(RPC_SERVER_CONTRIBUTION).toConstantValue({
      id: "generator.rpc",
      windows: ["main", "project"],
      create: (scope) =>
        new GeneratorRpcServer(scope.get(GENERATOR_APPLICATION)),
    });
  });
}
