import type { AgentProjectSummary } from "@/shared/agent-project";
import { AGENT_PROJECTS_RPC } from "@/shared/agent-project-rpc";
import { createRpcClient } from "@/shared/namespaced-rpc";

import { createElectrobunRpcClientTransport } from "./namespaced-rpc-client";

export interface AgentProjectClient {
  list(): Promise<readonly AgentProjectSummary[]>;
  open(rootPath: string): Promise<void>;
  pickAndOpen(): Promise<void>;
}

/** Access the main-process Agent Project catalog and window manager. */
export function createAgentProjectClient(): AgentProjectClient {
  const client = createRpcClient(
    AGENT_PROJECTS_RPC,
    createElectrobunRpcClientTransport()
  );
  return {
    list: () => client.list(),
    open: (rootPath) => client.open(rootPath),
    pickAndOpen: () => client.pickAndOpen(),
  };
}
