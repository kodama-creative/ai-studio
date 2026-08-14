import { createRpcClientProxy } from "../shared/namespaced-rpc";
import {
  AGENT_EXECUTION_RPC,
  BUILTIN_TOOLS_RPC,
  MCP_RPC,
  MODELS_RPC,
  NETWORK_RPC,
  PROMPT_FILES_RPC,
  RUNTIMES_RPC,
  SEARCH_RPC,
  SKILLS_RPC,
  WORKSPACE_RPC,
} from "../shared/runtime-rpc";

import { createElectrobunRpcClientTransport } from "./namespaced-rpc-client";

const transport = createElectrobunRpcClientTransport();
export const runtimesClient = createRpcClientProxy(RUNTIMES_RPC, transport);
export const modelsClient = createRpcClientProxy(MODELS_RPC, transport);
export const workspaceClient = createRpcClientProxy(WORKSPACE_RPC, transport);
export const promptFilesClient = createRpcClientProxy(PROMPT_FILES_RPC, transport);
export const mcpClient = createRpcClientProxy(MCP_RPC, transport);
export const builtinToolsClient = createRpcClientProxy(BUILTIN_TOOLS_RPC, transport);
export const searchClient = createRpcClientProxy(SEARCH_RPC, transport);
export const networkClient = createRpcClientProxy(NETWORK_RPC, transport);
export const skillsClient = createRpcClientProxy(SKILLS_RPC, transport);
export const agentExecutionClient = createRpcClientProxy(AGENT_EXECUTION_RPC, transport);
