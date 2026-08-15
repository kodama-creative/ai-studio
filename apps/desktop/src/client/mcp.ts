import type {
  McpCallToolResponse,
  McpServerDraft,
  McpServerToolsResponse,
  McpServerView,
} from "@llm-space/core";

import { MCP_RPC } from "@/shared/mcp-rpc";
import { createRpcClient } from "@/shared/namespaced-rpc";

import { createElectrobunRpcClientTransport } from "./namespaced-rpc-client";

const mcpClient = createRpcClient(
  MCP_RPC,
  createElectrobunRpcClientTransport()
);

export async function listMcpServers(): Promise<McpServerView[]> {
  return mcpClient.listServers();
}

export async function addMcpServer(
  server: McpServerDraft
): Promise<McpServerView[]> {
  return mcpClient.addServer(server);
}

export async function updateMcpServer(
  serverId: string,
  server: McpServerDraft
): Promise<McpServerView[]> {
  return mcpClient.updateServer(serverId, server);
}

export async function removeMcpServer(serverId: string): Promise<McpServerView[]> {
  return mcpClient.removeServer(serverId);
}

export async function disconnectMcpServer(serverId: string): Promise<McpServerView[]> {
  return mcpClient.disconnectServer(serverId);
}

export async function cancelMcpTest(serverId: string): Promise<McpServerView[]> {
  return mcpClient.cancelTest(serverId);
}

export async function listMcpTools(serverId: string): Promise<McpServerToolsResponse> {
  return mcpClient.listTools(serverId);
}

export async function callMcpTool(
  input: {
    serverId: string;
    toolName: string;
    arguments: Record<string, unknown>;
  }
): Promise<McpCallToolResponse> {
  return mcpClient.callTool(input);
}
