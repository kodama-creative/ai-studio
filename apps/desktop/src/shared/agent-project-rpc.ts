import type { AgentProjectSummary } from "./agent-project";
import { defineRpcNamespace } from "./namespaced-rpc";

export const AGENT_PROJECTS_SERVICE = Symbol("AgentProjectsService");

export interface AgentProjectsRequests {
  list(): Promise<readonly AgentProjectSummary[]>;
  open(rootPath?: string): Promise<void>;
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
    requests: { list: true, open: true },
    streams: {},
    events: { changed: true, openFailed: true },
  }
);
