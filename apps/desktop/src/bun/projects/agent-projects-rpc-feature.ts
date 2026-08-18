import { ContainerModule, inject, injectable } from "inversify";

import {
  AGENT_PROJECTS_RPC,
  type AgentProjectsRpc,
} from "../../shared/agent-project-rpc";
import {
  RpcContribution,
  type RpcContribution as RpcContributionApi,
} from "../di/rpc-contribution";
import type { RpcRegistry } from "../di/rpc-registry";

import { AgentProjectsApplication } from "./agent-projects-application";

/** Expose Project catalog use cases only to the Main renderer. */
@injectable()
class AgentProjectsRpcContribution implements RpcContributionApi {
  constructor(
    @inject(AgentProjectsApplication)
    private readonly _application: AgentProjectsApplication
  ) {}

  registerRpc(rpc: RpcRegistry): void {
    rpc.registerServer({
      namespace: AGENT_PROJECTS_RPC,
      requests: this._application,
      streams: {},
      eventSource: this._application.events,
    } satisfies import("../../shared/namespaced-rpc").RpcServer<AgentProjectsRpc>);
  }
}

/** Bind Agent Projects transport for one Main window. */
export function agentProjectsRpcModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(AgentProjectsRpcContribution).toSelf().inSingletonScope();
    bind<RpcContributionApi>(RpcContribution).toService(
      AgentProjectsRpcContribution
    );
  });
}
