import type { McpManager } from "@llm-space/runtime/mcp";
import type { ModelManager } from "@llm-space/runtime/models";
import type { NetworkSettingsManager } from "@llm-space/runtime/network";
import type { SearchSettingsManager } from "@llm-space/runtime/search";
import type { SkillsManager } from "@llm-space/runtime/skills";
import type { ToolRegistry } from "@llm-space/runtime/tools";
import { ContainerModule } from "inversify";

import type { DesktopWindowScope } from "../di/process-container";
import {
  RpcContribution,
  type RpcContribution as RpcContributionApi,
} from "../di/rpc-contribution";
import type { RpcRegistry } from "../di/rpc-registry";
import { desktopToken, PROCESS_TOKENS } from "../di/tokens";
import { AuxiliaryGenerationRpcServer } from "../rpc/auxiliary-generation-rpc-server";
import { BuiltinToolsRpcContribution } from "../rpc/builtin-tools-rpc-feature";
import { McpRpcContribution } from "../rpc/mcp-rpc-feature";
import { ModelsRpcContribution } from "../rpc/models-rpc-feature";
import { NetworkRpcContribution } from "../rpc/network-rpc-feature";
import { PromptFilesRpcContribution } from "../rpc/prompt-files-rpc-feature";
import { SearchRpcContribution } from "../rpc/search-rpc-feature";
import { SkillsRpcContribution } from "../rpc/skills-rpc-feature";

import { AuxiliaryGenerationApplication } from "./auxiliary-generation-application";
import {
  ModelsApplicationImpl,
  type ModelsApplication,
} from "./runtime-applications";

export const RUNTIME_APPLICATION_TOKENS = {
  auxiliaryGeneration: desktopToken<AuxiliaryGenerationApplication>(
    "auxiliary-generation",
    "application"
  ),
  models: desktopToken<ModelsApplication>("models", "application"),
} as const;

/** Register the two host capabilities that own application use cases. */
export function runtimeApplicationsModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind<AuxiliaryGenerationApplication>(
      RUNTIME_APPLICATION_TOKENS.auxiliaryGeneration
    )
      .toDynamicValue((context) => {
        const modelManager = context.get<ModelManager>(
          PROCESS_TOKENS.modelManager
        );
        return new AuxiliaryGenerationApplication({
          models: () => modelManager.getAvailableModels(),
          resolveConnection: ({ providerId, profileId }) =>
            modelManager.resolveConnection({ providerId, profileId }),
        });
      })
      .inSingletonScope();
    bind<ModelsApplication>(RUNTIME_APPLICATION_TOKENS.models)
      .toDynamicValue(
        (context) =>
          new ModelsApplicationImpl(
            context.get(PROCESS_TOKENS.modelManager),
            context.get(PROCESS_TOKENS.analytics)
          )
      )
      .inSingletonScope();
  });
}

class AuxiliaryGenerationContribution implements RpcContributionApi {
  constructor(private readonly _application: AuxiliaryGenerationApplication) {}

  registerRpc(rpc: RpcRegistry): void {
    rpc.registerServer(new AuxiliaryGenerationRpcServer(this._application));
  }
}

/** Bind every host capability as its own window-scoped RPC contribution. */
export function runtimeContributionsModule(
  scope: DesktopWindowScope
): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(AuxiliaryGenerationContribution)
      .toDynamicValue(
        () =>
          new AuxiliaryGenerationContribution(
            scope.get(RUNTIME_APPLICATION_TOKENS.auxiliaryGeneration)
          )
      )
      .inSingletonScope();
    bind(ModelsRpcContribution)
      .toDynamicValue(
        () =>
          new ModelsRpcContribution(
            scope.get(RUNTIME_APPLICATION_TOKENS.models)
          )
      )
      .inSingletonScope();
    bind(PromptFilesRpcContribution)
      .toDynamicValue(() => new PromptFilesRpcContribution())
      .inSingletonScope();
    bind(McpRpcContribution)
      .toDynamicValue(
        () =>
          new McpRpcContribution(
            scope.get<McpManager>(PROCESS_TOKENS.mcpManager)
          )
      )
      .inSingletonScope();
    bind(BuiltinToolsRpcContribution)
      .toDynamicValue(
        () =>
          new BuiltinToolsRpcContribution(
            scope.get<{ tools: ToolRegistry }>(PROCESS_TOKENS.desktopHost).tools
          )
      )
      .inSingletonScope();
    bind(SearchRpcContribution)
      .toDynamicValue(
        () =>
          new SearchRpcContribution(
            scope.get<SearchSettingsManager>(PROCESS_TOKENS.searchSettings)
          )
      )
      .inSingletonScope();
    bind(NetworkRpcContribution)
      .toDynamicValue(
        () =>
          new NetworkRpcContribution(
            scope.get<NetworkSettingsManager>(PROCESS_TOKENS.networkSettings)
          )
      )
      .inSingletonScope();
    bind(SkillsRpcContribution)
      .toDynamicValue(
        () =>
          new SkillsRpcContribution(
            scope.get<SkillsManager>(PROCESS_TOKENS.skillsManager)
          )
      )
      .inSingletonScope();

    for (const contribution of [
      AuxiliaryGenerationContribution,
      ModelsRpcContribution,
      PromptFilesRpcContribution,
      McpRpcContribution,
      BuiltinToolsRpcContribution,
      SearchRpcContribution,
      NetworkRpcContribution,
      SkillsRpcContribution,
    ]) {
      bind<RpcContributionApi>(RpcContribution).toService(contribution);
    }
  });
}
