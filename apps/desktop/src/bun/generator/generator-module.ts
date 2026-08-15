import type { ModelManager } from "@llm-space/runtime/models";
import { ContainerModule, type ResolutionContext } from "inversify";

import { GENERATOR_RPC, type GeneratorRpc } from "../../shared/generator-rpc";
import type { RpcServer } from "../../shared/namespaced-rpc";
import {
  RpcContribution,
  type RpcContribution as RpcContributionApi,
} from "../di/rpc-contribution";
import type { RpcRegistry } from "../di/rpc-registry";
import { desktopToken, PROCESS_TOKENS } from "../di/tokens";
import {
  NATIVE_DIALOGS_APPLICATION,
  type NativeDialogsApplication,
} from "../native/native-dialogs-module";

import { ProjectGeneratorApplication } from "./project-generator-application";

export const GENERATOR_APPLICATION =
  desktopToken<ProjectGeneratorApplication>("generator", "application");

class GeneratorRpcServer implements RpcServer<GeneratorRpc> {
  readonly namespace = GENERATOR_RPC;
  readonly streams = {};

  constructor(readonly requests: ProjectGeneratorApplication) {}
}

/** Register the process-scoped Generator application and its RPC adapter. */
export function generatorModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind<ProjectGeneratorApplication>(GENERATOR_APPLICATION)
      .toDynamicValue(
        (context: ResolutionContext) =>
          new ProjectGeneratorApplication(
            context.get<NativeDialogsApplication>(NATIVE_DIALOGS_APPLICATION),
            context.get<ModelManager>(PROCESS_TOKENS.modelManager)
          )
      )
      .inSingletonScope();
  });
}

class GeneratorContribution implements RpcContributionApi {
  constructor(private readonly _application: ProjectGeneratorApplication) {}

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
