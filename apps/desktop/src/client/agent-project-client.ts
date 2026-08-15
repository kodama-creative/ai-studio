import {
  AGENT_PROJECTS_RPC,
  type AgentProjectsRpc,
} from "@/shared/agent-project-rpc";
import { createRpcClient, type RpcClient } from "@/shared/namespaced-rpc";

import { createElectrobunRpcClientTransport } from "./namespaced-rpc-client";

export type AgentProjectClient = RpcClient<AgentProjectsRpc>;

/** Access the main-process Agent Project catalog and window manager. */
export function createAgentProjectClient(): AgentProjectClient {
  return createRpcClient(
    AGENT_PROJECTS_RPC,
    createElectrobunRpcClientTransport()
  );
}
