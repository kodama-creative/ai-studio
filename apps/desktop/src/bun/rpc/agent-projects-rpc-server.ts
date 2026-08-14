import {
  AGENT_PROJECTS_RPC,
  type AgentProjectsRpc,
} from "../../shared/agent-project-rpc";
import type { RpcServer } from "../../shared/namespaced-rpc";
import type { AgentProjectsApplicationApi } from "../application/agent-projects-application";

/** Typed transport adapter for Agent Project catalog/window use cases. */
export class AgentProjectsRpcServer implements RpcServer<AgentProjectsRpc> {
  readonly namespace = AGENT_PROJECTS_RPC;
  readonly streams = {};
  constructor(readonly requests: AgentProjectsApplicationApi) {}
}
