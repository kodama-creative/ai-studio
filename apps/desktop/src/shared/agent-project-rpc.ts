import type { AgentProjectSummary } from "./agent-project";
import { defineRpcNamespace } from "./namespaced-rpc";

export interface AgentProjectsRequests {
  list(): Promise<readonly AgentProjectSummary[]>;
}

export interface AgentProjectsEvents {
  changed: Record<string, never>;
  openFailed: { message: string };
}

export interface AgentProjectsRpc {
  readonly requests: AgentProjectsRequests;
  readonly streams: Record<never, never>;
  readonly events: AgentProjectsEvents;
}

export const AGENT_PROJECTS_RPC = defineRpcNamespace<AgentProjectsRpc>(
  "agentProjects",
  {
    requests: { list: true },
    streams: {},
    events: { changed: true, openFailed: true },
  }
);
