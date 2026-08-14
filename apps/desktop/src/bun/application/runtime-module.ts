import type { RuntimeRouter } from "@llm-space/runtime/runtime";
import { ContainerModule, type ResolutionContext } from "inversify";

import {
  RPC_SERVER_CONTRIBUTION,
  type RpcServerContribution,
} from "../di/rpc-contribution";
import { desktopToken, PROCESS_TOKENS } from "../di/tokens";
import {
  AgentExecutionRpcServer,
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

import {
  AgentExecutionApplicationImpl,
  type AgentExecutionApplication,
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
  runtimes: desktopToken<RuntimesApplication>("runtime", "runtimes-application"),
  models: desktopToken<ModelsApplication>("runtime", "models-application"),
  workspace: desktopToken<WorkspaceApplication>("runtime", "workspace-application"),
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
  agentExecution: desktopToken<AgentExecutionApplication>(
    "runtime",
    "agent-execution-application"
  ),
} as const;

/** Register Runtime capability applications and their main-window RPC adapters. */
export function runtimeApplicationsModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
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
    bind<AgentExecutionApplication>(RUNTIME_APPLICATION_TOKENS.agentExecution)
      .toDynamicValue(
        (context) => new AgentExecutionApplicationImpl(router(context))
      )
      .inSingletonScope();

    const contribute = (
      id: RpcServerContribution["id"],
      create: RpcServerContribution["create"]
    ) =>
      bind<RpcServerContribution>(RPC_SERVER_CONTRIBUTION).toConstantValue({
        id,
        windows: ["main", "project"],
        create,
      });
    contribute(
      "runtime.runtimes.rpc",
      (scope) =>
        new RuntimesRpcServer(scope.get(RUNTIME_APPLICATION_TOKENS.runtimes))
    );
    contribute(
      "runtime.models.rpc",
      (scope) =>
        new ModelsRpcServer(scope.get(RUNTIME_APPLICATION_TOKENS.models))
    );
    contribute(
      "runtime.workspace.rpc",
      (scope) =>
        new WorkspaceRpcServer(scope.get(RUNTIME_APPLICATION_TOKENS.workspace))
    );
    contribute(
      "runtime.prompt-files.rpc",
      (scope) =>
        new PromptFilesRpcServer(
          scope.get(RUNTIME_APPLICATION_TOKENS.promptFiles)
        )
    );
    contribute(
      "runtime.mcp.rpc",
      (scope) => new McpRpcServer(scope.get(RUNTIME_APPLICATION_TOKENS.mcp))
    );
    contribute(
      "runtime.builtin-tools.rpc",
      (scope) =>
        new BuiltinToolsRpcServer(
          scope.get(RUNTIME_APPLICATION_TOKENS.builtinTools)
        )
    );
    contribute(
      "runtime.search.rpc",
      (scope) =>
        new SearchRpcServer(scope.get(RUNTIME_APPLICATION_TOKENS.search))
    );
    contribute(
      "runtime.network.rpc",
      (scope) =>
        new NetworkRpcServer(scope.get(RUNTIME_APPLICATION_TOKENS.network))
    );
    contribute(
      "runtime.skills.rpc",
      (scope) =>
        new SkillsRpcServer(scope.get(RUNTIME_APPLICATION_TOKENS.skills))
    );
    contribute(
      "runtime.agent-execution.rpc",
      (scope) =>
        new AgentExecutionRpcServer(
          scope.get(RUNTIME_APPLICATION_TOKENS.agentExecution)
        )
    );
  });
}
