import type { McpManager } from "@llm-space/runtime/mcp";

import {
  MCP_RPC,
  type McpRequests,
  type McpRpc,
} from "../../shared/mcp-rpc";
import type { RpcServer } from "../../shared/namespaced-rpc";
import type { RpcContribution } from "../di/rpc-contribution";
import type { RpcRegistry } from "../di/rpc-registry";

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
export class McpRpcContribution implements RpcContribution {
  constructor(private readonly _mcp: McpManager) {}

  registerRpc(rpc: RpcRegistry): void {
    rpc.registerServer(new McpRpcServer(this._mcp));
  }
}
