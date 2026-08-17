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
import { NativeDialogsApplication } from "../native/native-dialogs-module";

import {
  AgentProjectsApplication,
  DirectoryPicker,
  type DirectoryPicker as DirectoryPickerApi,
} from "./agent-projects-application";

/** Bind the process-scoped Agent Project use cases. */
export function agentProjectsModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind<DirectoryPickerApi>(DirectoryPicker).toService(
      NativeDialogsApplication
    );
    bind(AgentProjectsApplication)
      .toSelf()
      .inSingletonScope()
      .onDeactivation((application) => application.dispose());
  });
}

@injectable()
class AgentProjectsRpcContribution implements RpcContributionApi {
  constructor(
    @inject(AgentProjectsApplication)
    private readonly _application: AgentProjectsApplication
  ) {}

  /** Expose project catalog operations only to the Main renderer. */
  registerRpc(rpc: RpcRegistry): void {
    rpc.registerServer({
      namespace: AGENT_PROJECTS_RPC,
      requests: this._application,
      streams: {},
      eventSource: this._application.events,
    } satisfies import("../../shared/namespaced-rpc").RpcServer<AgentProjectsRpc>);
  }
}

/** Bind the Agent Project catalog RPC exposed only by the Main window. */
export function agentProjectsRpcModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(AgentProjectsRpcContribution).toSelf().inSingletonScope();
    bind<RpcContributionApi>(RpcContribution).toService(
      AgentProjectsRpcContribution
    );
  });
}
