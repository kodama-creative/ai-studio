import { electrobun } from "@/lib/electrobun";
import type { AgentProjectSummary } from "@/shared/agent-project";


export interface AgentProjectClient {
  list(): Promise<readonly AgentProjectSummary[]>;
  open(rootPath: string): Promise<void>;
  pickAndOpen(): Promise<void>;
}

/** Access the main-process Agent Project catalog and window manager. */
export function createAgentProjectClient(): AgentProjectClient {
  const rpc = electrobun.rpc;
  if (rpc === undefined) throw new Error("Electrobun RPC is not initialized.");
  return {
    list: () => rpc.request.agentProjectList({}),
    open: async (rootPath) => {
      await rpc.request.agentProjectOpen({ rootPath });
    },
    pickAndOpen: async () => {
      await rpc.request.agentProjectPickAndOpen({});
    },
  };
}
