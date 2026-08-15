import type { McpManager } from "@llm-space/runtime/mcp";
import type { ModelManager } from "@llm-space/runtime/models";
import { ContainerModule, type ResolutionContext } from "inversify";

import { DesktopPlaygroundApplicationImpl } from "../application/playground-application";
import type { DesktopWindowScope } from "../di/process-container";
import {
  RpcContribution,
  type RpcContribution as RpcContributionApi,
} from "../di/rpc-contribution";
import type { RpcRegistry } from "../di/rpc-registry";
import { PROCESS_TOKENS, WINDOW_TOKENS } from "../di/tokens";
import type { DesktopHost } from "../host/desktop-host";
import { PlaygroundRpcServer } from "../rpc/playground-rpc-server";
import { PlaygroundThreadRpcServer } from "../rpc/thread-rpc-server";

import { createPlaygroundHost } from "./playground-host";

/** Bind the process-owned Playground host and application facade. */
export function playgroundModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(PROCESS_TOKENS.playgroundHost)
      .toDynamicValue((context: ResolutionContext) => {
        const modelManager = context.get<ModelManager>(
          PROCESS_TOKENS.modelManager
        );
        const desktopHost = context.get<DesktopHost>(
          PROCESS_TOKENS.desktopHost
        );
        const mcpManager = context.get<McpManager>(PROCESS_TOKENS.mcpManager);
        return createPlaygroundHost({
          homePath: context.get(PROCESS_TOKENS.homePath),
          models: () => modelManager.getAvailableModels(),
          resolveConnection: ({ providerId }) =>
            modelManager.resolveConnection({ providerId }),
          tools: {
            listBuiltinTools: () => desktopHost.tools.listTools(),
            callBuiltinTool: (input) => desktopHost.tools.call(input),
            listMcpTools: (serverId) => mcpManager.listTools(serverId),
            callMcpTool: (input) => mcpManager.callTool(input),
          },
        });
      })
      .inSingletonScope();
    bind(PROCESS_TOKENS.playgroundApplication)
      .toDynamicValue(
        (context: ResolutionContext) =>
          new DesktopPlaygroundApplicationImpl(
            context.get(PROCESS_TOKENS.playgroundHost)
          )
      )
      .inSingletonScope();
  });
}

/** Identify the Main window as the durable Playground catalog. */
export function playgroundWindowModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(WINDOW_TOKENS.context).toConstantValue({ kind: "playground" });
  });
}

class PlaygroundContribution implements RpcContributionApi {
  constructor(
    private readonly _application: DesktopPlaygroundApplicationImpl
  ) {}

  registerRpc(rpc: RpcRegistry): void {
    rpc.registerServer(new PlaygroundRpcServer(this._application));
    rpc.registerServer(new PlaygroundThreadRpcServer(this._application));
  }
}

/** Bind Main-only Playground transport adapters in the window scope. */
export function playgroundContributionsModule(
  scope: DesktopWindowScope
): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(PlaygroundContribution)
      .toDynamicValue(
        () =>
          new PlaygroundContribution(
            scope.get(PROCESS_TOKENS.playgroundApplication)
          )
      )
      .inSingletonScope();
    bind<RpcContributionApi>(RpcContribution).toService(PlaygroundContribution);
  });
}
