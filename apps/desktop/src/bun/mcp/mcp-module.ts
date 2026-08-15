import type { McpManager } from "@llm-space/runtime/mcp";
import { ContainerModule } from "inversify";

import {
  MCP_RPC,
  type McpRequests,
  type McpRpc,
} from "../../shared/mcp-rpc";
import type { RpcServer } from "../../shared/namespaced-rpc";
import {
  RpcContribution,
  type RpcContribution as RpcContributionApi,
} from "../di/rpc-contribution";
import type { RpcRegistry } from "../di/rpc-registry";
import { desktopToken } from "../di/tokens";
import { bindWindowFeature, windowFeature } from "../di/window-feature";

export const MCP_MANAGER = desktopToken<McpManager>("mcp", "manager");

class McpRpcServer implements RpcServer<McpRpc> {
  readonly namespace = MCP_RPC;
  readonly streams = {};
  readonly requests: McpRequests;

  constructor(mcp: McpManager) {
    this.requests = {
      listServers: () => Promise.resolve(mcp.listServers()),
      addServer: (server) => Promise.resolve(mcp.addServer(server)),
      updateServer: (serverId, server) => mcp.updateServer(serverId, server),
      removeServer: (serverId) => mcp.removeServer(serverId),
      disconnectServer: (serverId) => mcp.disconnectServer(serverId),
      cancelTest: (serverId) => mcp.cancelTest(serverId),
      listTools: (serverId) => mcp.listTools(serverId),
      callTool: (input) => mcp.callTool(input),
    };
  }
}

/** Owns MCP configuration and tool-call RPC for one native window. */
class McpRpcContribution implements RpcContributionApi {
  constructor(private readonly _mcp: McpManager) {}

  registerRpc(rpc: RpcRegistry): void {
    rpc.registerServer(new McpRpcServer(this._mcp));
  }
}

/** Bind MCP configuration and tool RPC as one window contribution. */
export function mcpRpcModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(McpRpcContribution)
      .toDynamicValue(
        (context) =>
          new McpRpcContribution(
            context.get<McpManager>(MCP_MANAGER)
          )
      )
      .inSingletonScope();
    bind<RpcContributionApi>(RpcContribution).toService(McpRpcContribution);
  });
}

/** Register MCP settings and tool RPC as one bundled window feature. */
export function mcpModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bindWindowFeature(
      bind,
      windowFeature("mcp", (scope) => scope.load(mcpRpcModule()))
    );
  });
}
