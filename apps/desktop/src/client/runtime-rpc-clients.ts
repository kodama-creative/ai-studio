import { createRpcClient } from "../shared/namespaced-rpc";
import {
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
export const runtimesClient = createRpcClient(RUNTIMES_RPC, transport);
export const modelsClient = createRpcClient(MODELS_RPC, transport);
export const workspaceClient = createRpcClient(WORKSPACE_RPC, transport);
export const promptFilesClient = createRpcClient(PROMPT_FILES_RPC, transport);
export const mcpClient = createRpcClient(MCP_RPC, transport);
export const builtinToolsClient = createRpcClient(BUILTIN_TOOLS_RPC, transport);
export const searchClient = createRpcClient(SEARCH_RPC, transport);
export const networkClient = createRpcClient(NETWORK_RPC, transport);
export const skillsClient = createRpcClient(SKILLS_RPC, transport);
