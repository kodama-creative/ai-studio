import { MCP_RPC, type McpRequests } from "@/shared/mcp-rpc";
import { createRpcClient } from "@/shared/namespaced-rpc";

import { createElectrobunRpcClientTransport } from "./namespaced-rpc-client";

export type McpClient = McpRequests;

/** Create one typed MCP namespace proxy for its owning renderer module. */
export function createMcpClient(): McpClient {
  return createRpcClient(MCP_RPC, createElectrobunRpcClientTransport());
}
