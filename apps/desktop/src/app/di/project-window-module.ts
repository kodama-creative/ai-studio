import { ContainerModule } from "inversify";

import type { AgentProjectView } from "@/shared/agent-project";
import {
  createRpcClient,
  type RpcClient,
  type RpcClientTransport,
} from "@/shared/namespaced-rpc";
import {
  PROJECT_SOURCE_RPC,
  PROJECT_SOURCE_SERVICE,
  type ProjectSourceRpc,
} from "@/shared/project-source-rpc";
import { STUDIO_RPC, STUDIO_SERVICE, type StudioRpc } from "@/shared/studio-rpc";

import { ProjectSourceController } from "../project/project-source-controller";
import { ProjectThreadsController } from "../project/project-threads-controller";
import { ProjectWorkspaceController } from "../project/project-workspace-controller";

import { RENDERER_LIFECYCLE_CONTRIBUTION } from "./lifecycle";
export const AGENT_PROJECT_VIEW = Symbol("AgentProjectView");
export function rendererProjectWindowModule(
  project: AgentProjectView,
  transport: RpcClientTransport
): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind<AgentProjectView>(AGENT_PROJECT_VIEW).toConstantValue(project);
    bind<RpcClient<StudioRpc>>(STUDIO_SERVICE).toConstantValue(
      createRpcClient(STUDIO_RPC, transport)
    );
    bind<RpcClient<ProjectSourceRpc>>(PROJECT_SOURCE_SERVICE).toConstantValue(
      createRpcClient(PROJECT_SOURCE_RPC, transport)
    );
    bind(ProjectThreadsController).toSelf().inSingletonScope();
    bind(ProjectSourceController).toSelf().inSingletonScope();
    bind(ProjectWorkspaceController).toSelf().inSingletonScope();
    bind(RENDERER_LIFECYCLE_CONTRIBUTION).toService(
      ProjectWorkspaceController
    );
  });
}
