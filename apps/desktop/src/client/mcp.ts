import type {
  McpCallToolResponse,
  McpServerDraft,
  McpServerToolsResponse,
  McpServerView,
} from "@llm-space/core";

import type { RuntimeId } from "@/shared/runtime";

import { mcpClient } from "./runtime-rpc-clients";

export async function listMcpServers(
  runtimeId?: RuntimeId
): Promise<McpServerView[]> {
  return mcpClient.listServers(runtimeId);
}

export async function addMcpServer(
  server: McpServerDraft,
  runtimeId?: RuntimeId
): Promise<McpServerView[]> {
  return mcpClient.addServer(runtimeId, server);
}

export async function updateMcpServer(
  serverId: string,
  server: McpServerDraft,
  runtimeId?: RuntimeId
): Promise<McpServerView[]> {
  return mcpClient.updateServer(runtimeId, serverId, server);
}

export async function removeMcpServer(
  serverId: string,
  runtimeId?: RuntimeId
): Promise<McpServerView[]> {
  return mcpClient.removeServer(runtimeId, serverId);
}

export async function disconnectMcpServer(
  serverId: string,
  runtimeId?: RuntimeId
): Promise<McpServerView[]> {
  return mcpClient.disconnectServer(runtimeId, serverId);
}

export async function cancelMcpTest(
  serverId: string,
  runtimeId?: RuntimeId
): Promise<McpServerView[]> {
  return mcpClient.cancelTest(runtimeId, serverId);
}

export async function listMcpTools(
  serverId: string,
  runtimeId?: RuntimeId
): Promise<McpServerToolsResponse> {
  return mcpClient.listTools(runtimeId, serverId);
}

export async function callMcpTool(
  input: {
    serverId: string;
    toolName: string;
    arguments: Record<string, unknown>;
  },
  runtimeId?: RuntimeId
): Promise<McpCallToolResponse> {
  return mcpClient.callTool(runtimeId, input);
}
