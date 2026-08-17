import type {
  McpCallToolResponse,
  McpServerDraft,
  McpServerToolsResponse,
  McpServerView,
} from "@llm-space/core";

import { defineRpcNamespace } from "./namespaced-rpc";
import type { RequestRpcShape } from "./rpc-shape";

export const MCP_SERVICE = Symbol("McpService");

export interface McpRequests {
  listServers(): Promise<McpServerView[]>;
  addServer(server: McpServerDraft): Promise<McpServerView[]>;
  updateServer(
    serverId: string,
    server: McpServerDraft
  ): Promise<McpServerView[]>;
  removeServer(serverId: string): Promise<McpServerView[]>;
  disconnectServer(serverId: string): Promise<McpServerView[]>;
  cancelTest(serverId: string): Promise<McpServerView[]>;
  listTools(serverId: string): Promise<McpServerToolsResponse>;
  callTool(input: {
    serverId: string;
    toolName: string;
    arguments: Record<string, unknown>;
  }): Promise<McpCallToolResponse>;
}

export type McpRpc = RequestRpcShape<McpRequests>;

export const MCP_RPC = defineRpcNamespace<McpRpc>("mcp", {
  requests: {
    listServers: true,
    addServer: true,
    updateServer: true,
    removeServer: true,
    disconnectServer: true,
    cancelTest: true,
    listTools: true,
    callTool: true,
  },
  streams: {},
  events: {},
});
