import type { ModelManager } from "@llm-space/runtime/models";
import type { RuntimeRouter } from "@llm-space/runtime/runtime";
import { ContainerModule, type ResolutionContext } from "inversify";

import type { DesktopWindowScope } from "../di/process-container";
import {
  RpcContribution,
  type RpcContribution as RpcContributionApi,
} from "../di/rpc-contribution";
import type { RpcRegistry } from "../di/rpc-registry";
import { desktopToken, PROCESS_TOKENS } from "../di/tokens";
import { AuxiliaryGenerationRpcServer } from "../rpc/auxiliary-generation-rpc-server";
import {
  BuiltinToolsRpcServer,
  McpRpcServer,
  ModelsRpcServer,
  NetworkRpcServer,
  PromptFilesRpcServer,
  RuntimesRpcServer,
  SearchRpcServer,
  SkillsRpcServer,
  WorkspaceRpcServer,
} from "../rpc/runtime-rpc-servers";

import { AuxiliaryGenerationApplication } from "./auxiliary-generation-application";
import {
  BuiltinToolsApplicationImpl,
  type BuiltinToolsApplication,
  McpApplicationImpl,
  type McpApplication,
  ModelsApplicationImpl,
  type ModelsApplication,
  NetworkApplicationImpl,
  type NetworkApplication,
  PromptFilesApplicationImpl,
  type PromptFilesApplication,
  RuntimesApplicationImpl,
  type RuntimesApplication,
  SearchApplicationImpl,
  type SearchApplication,
  SkillsApplicationImpl,
  type SkillsApplication,
  WorkspaceApplicationImpl,
  type WorkspaceApplication,
} from "./runtime-applications";

export const RUNTIME_APPLICATION_TOKENS = {
  auxiliaryGeneration: desktopToken<AuxiliaryGenerationApplication>(
    "runtime",
    "auxiliary-generation-application"
  ),
  runtimes: desktopToken<RuntimesApplication>(
    "runtime",
    "runtimes-application"
  ),
  models: desktopToken<ModelsApplication>("runtime", "models-application"),
  workspace: desktopToken<WorkspaceApplication>(
    "runtime",
    "workspace-application"
  ),
  promptFiles: desktopToken<PromptFilesApplication>(
    "runtime",
    "prompt-files-application"
  ),
  mcp: desktopToken<McpApplication>("runtime", "mcp-application"),
  builtinTools: desktopToken<BuiltinToolsApplication>(
    "runtime",
    "builtin-tools-application"
  ),
  search: desktopToken<SearchApplication>("runtime", "search-application"),
  network: desktopToken<NetworkApplication>("runtime", "network-application"),
  skills: desktopToken<SkillsApplication>("runtime", "skills-application"),
} as const;

/** Register Runtime capability applications and their main-window RPC adapters. */
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
    const router = (context: ResolutionContext) =>
      context.get<RuntimeRouter>(PROCESS_TOKENS.runtimeRouter);
    bind<RuntimesApplication>(RUNTIME_APPLICATION_TOKENS.runtimes)
      .toDynamicValue((context) => new RuntimesApplicationImpl(router(context)))
      .inSingletonScope();
    bind<ModelsApplication>(RUNTIME_APPLICATION_TOKENS.models)
      .toDynamicValue(
        (context) =>
          new ModelsApplicationImpl(
            router(context),
            context.get(PROCESS_TOKENS.analytics)
          )
      )
      .inSingletonScope();
    bind<WorkspaceApplication>(RUNTIME_APPLICATION_TOKENS.workspace)
      .toDynamicValue(
        (context) => new WorkspaceApplicationImpl(router(context))
      )
      .inSingletonScope();
    bind<PromptFilesApplication>(RUNTIME_APPLICATION_TOKENS.promptFiles)
      .toDynamicValue(
        (context) => new PromptFilesApplicationImpl(router(context))
      )
      .inSingletonScope();
    bind<McpApplication>(RUNTIME_APPLICATION_TOKENS.mcp)
      .toDynamicValue((context) => new McpApplicationImpl(router(context)))
      .inSingletonScope();
    bind<BuiltinToolsApplication>(RUNTIME_APPLICATION_TOKENS.builtinTools)
      .toDynamicValue(
        (context) => new BuiltinToolsApplicationImpl(router(context))
      )
      .inSingletonScope();
    bind<SearchApplication>(RUNTIME_APPLICATION_TOKENS.search)
      .toDynamicValue((context) => new SearchApplicationImpl(router(context)))
      .inSingletonScope();
    bind<NetworkApplication>(RUNTIME_APPLICATION_TOKENS.network)
      .toDynamicValue((context) => new NetworkApplicationImpl(router(context)))
      .inSingletonScope();
    bind<SkillsApplication>(RUNTIME_APPLICATION_TOKENS.skills)
      .toDynamicValue((context) => new SkillsApplicationImpl(router(context)))
      .inSingletonScope();
  });
}

class RuntimeContribution implements RpcContributionApi {
  constructor(
    private readonly _auxiliaryGeneration: AuxiliaryGenerationApplication,
    private readonly _runtimes: RuntimesApplication,
    private readonly _models: ModelsApplication,
    private readonly _workspace: WorkspaceApplication,
    private readonly _promptFiles: PromptFilesApplication,
    private readonly _mcp: McpApplication,
    private readonly _builtinTools: BuiltinToolsApplication,
    private readonly _search: SearchApplication,
    private readonly _network: NetworkApplication,
    private readonly _skills: SkillsApplication
  ) {}

  /** Register the Runtime-owned request and stream namespaces. */
  registerRpc(rpc: RpcRegistry): void {
    rpc.registerServer(
      new AuxiliaryGenerationRpcServer(this._auxiliaryGeneration)
    );
    rpc.registerServer(new RuntimesRpcServer(this._runtimes));
    rpc.registerServer(new ModelsRpcServer(this._models));
    rpc.registerServer(new WorkspaceRpcServer(this._workspace));
    rpc.registerServer(new PromptFilesRpcServer(this._promptFiles));
    rpc.registerServer(new McpRpcServer(this._mcp));
    rpc.registerServer(new BuiltinToolsRpcServer(this._builtinTools));
    rpc.registerServer(new SearchRpcServer(this._search));
    rpc.registerServer(new NetworkRpcServer(this._network));
    rpc.registerServer(new SkillsRpcServer(this._skills));
  }
}

/** Bind Runtime RPC declarations as one window-scoped feature contribution. */
export function runtimeContributionsModule(
  scope: DesktopWindowScope
): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(RuntimeContribution)
      .toDynamicValue(
        () =>
          new RuntimeContribution(
            scope.get(RUNTIME_APPLICATION_TOKENS.auxiliaryGeneration),
            scope.get(RUNTIME_APPLICATION_TOKENS.runtimes),
            scope.get(RUNTIME_APPLICATION_TOKENS.models),
            scope.get(RUNTIME_APPLICATION_TOKENS.workspace),
            scope.get(RUNTIME_APPLICATION_TOKENS.promptFiles),
            scope.get(RUNTIME_APPLICATION_TOKENS.mcp),
            scope.get(RUNTIME_APPLICATION_TOKENS.builtinTools),
            scope.get(RUNTIME_APPLICATION_TOKENS.search),
            scope.get(RUNTIME_APPLICATION_TOKENS.network),
            scope.get(RUNTIME_APPLICATION_TOKENS.skills)
          )
      )
      .inSingletonScope();
    bind<RpcContributionApi>(RpcContribution).toService(RuntimeContribution);
  });
}
