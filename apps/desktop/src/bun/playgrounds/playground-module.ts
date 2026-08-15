import type { McpManager } from "@llm-space/runtime/mcp";
import type { ModelManager } from "@llm-space/runtime/models";
import { ContainerModule, type ResolutionContext } from "inversify";

import {
  RpcContribution,
  type RpcContribution as RpcContributionApi,
} from "../di/rpc-contribution";
import type { RpcRegistry } from "../di/rpc-registry";
import { desktopToken } from "../di/tokens";
import { bindWindowFeature, windowFeature } from "../di/window-feature";
import type { DesktopHost } from "../host/desktop-host";
import { DESKTOP_HOST } from "../host/desktop-host-module";
import { MCP_MANAGER } from "../mcp/mcp-module";
import { MODEL_MANAGER } from "../models/models-module";
import { APP_HOME_PATH } from "../native/app-directories-module";
import { WINDOW_CONTEXT } from "../native/native-window-module";
import { PlaygroundThreadRpcServer } from "../thread/thread-rpc-server";

import {
  createDesktopPlaygroundApplication,
  type DesktopPlaygroundApplication,
} from "./playground-application";
import { PlaygroundRpcServer } from "./playground-rpc-server";

export const PLAYGROUND_APPLICATION =
  desktopToken<DesktopPlaygroundApplication>("playground", "application");

/** Bind the process-owned Playground application host. */
export function playgroundModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(PLAYGROUND_APPLICATION)
      .toDynamicValue((context: ResolutionContext) => {
        const modelManager = context.get<ModelManager>(
          MODEL_MANAGER
        );
        const desktopHost = context.get<DesktopHost>(
          DESKTOP_HOST
        );
        const mcpManager = context.get<McpManager>(MCP_MANAGER);
        return createDesktopPlaygroundApplication({
          homePath: context.get(APP_HOME_PATH),
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
    bindWindowFeature(
      bind,
      windowFeature("playground", (scope, { kind }) => {
        if (kind === "main") scope.load(playgroundContributionsModule());
      })
    );
  });
}

/** Identify the Main window as the durable Playground catalog. */
export function playgroundWindowModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(WINDOW_CONTEXT).toConstantValue({ kind: "playground" });
  });
}

class PlaygroundContribution implements RpcContributionApi {
  constructor(private readonly _application: DesktopPlaygroundApplication) {}

  registerRpc(rpc: RpcRegistry): void {
    rpc.registerServer(new PlaygroundRpcServer(this._application));
    rpc.registerServer(new PlaygroundThreadRpcServer(this._application));
  }
}

/** Bind Main-only Playground transport adapters in the window scope. */
export function playgroundContributionsModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(PlaygroundContribution)
      .toDynamicValue(
        (context) =>
          new PlaygroundContribution(
            context.get(PLAYGROUND_APPLICATION)
          )
      )
      .inSingletonScope();
    bind<RpcContributionApi>(RpcContribution).toService(PlaygroundContribution);
  });
}
