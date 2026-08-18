import { McpManager } from "@llm-space/runtime/mcp";
import { ContainerModule, inject, injectable } from "inversify";

import {
  MCP_RPC,
  type McpRequests,
  type McpRpc,
} from "../../shared/mcp-rpc";
import {
  RpcContribution,
  type RpcContribution as RpcContributionApi,
} from "../di/rpc-contribution";
import type { RpcRegistry } from "../di/rpc-registry";

/** Owns MCP configuration and tool-call RPC for one native window. */
@injectable()
class McpRpcContribution implements RpcContributionApi {
  constructor(@inject(McpManager) private readonly _mcp: McpManager) {}

  registerRpc(rpc: RpcRegistry): void {
    const requests: McpRequests = {
      listServers: () => Promise.resolve(this._mcp.listServers()),
      addServer: (server) => Promise.resolve(this._mcp.addServer(server)),
      updateServer: (serverId, server) =>
        this._mcp.updateServer(serverId, server),
      removeServer: (serverId) => this._mcp.removeServer(serverId),
      disconnectServer: (serverId) => this._mcp.disconnectServer(serverId),
      cancelTest: (serverId) => this._mcp.cancelTest(serverId),
      listTools: (serverId) => this._mcp.listTools(serverId),
      callTool: (input) => this._mcp.callTool(input),
    };
    rpc.registerServer({
      namespace: MCP_RPC,
      requests,
      streams: {},
    } satisfies import("../../shared/namespaced-rpc").RpcServer<McpRpc>);
  }
}

/** Bind MCP configuration and tool RPC as one window contribution. */
export function mcpRpcModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(McpRpcContribution).toSelf().inSingletonScope();
    bind<RpcContributionApi>(RpcContribution).toService(McpRpcContribution);
  });
}
