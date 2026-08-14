import type { AgentProjectSummary } from "./agent-project";
import { defineRpcNamespace } from "./namespaced-rpc";

export interface AgentProjectsRequests {
  list(): Promise<readonly AgentProjectSummary[]>;
  open(rootPath: string): Promise<void>;
  pickAndOpen(): Promise<void>;
}

export interface AgentProjectsRpc {
  readonly requests: AgentProjectsRequests;
  readonly streams: Record<never, never>;
  readonly events: Record<never, never>;
}

export const AGENT_PROJECTS_RPC = defineRpcNamespace<AgentProjectsRpc>(
  "agentProjects",
  { streams: [], events: [] }
);
