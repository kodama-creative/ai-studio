import type { Studio } from "@llm-space/studio/server";

import type { RpcServer } from "../../shared/namespaced-rpc";
import {
  PROJECT_STUDIO_RPC,
  type ProjectStudioRpc,
} from "../../shared/project-studio";

/** Project-owned transport adapter over the Studio application interface. */
export class ProjectRpcServer implements RpcServer<ProjectStudioRpc> {
  readonly namespace = PROJECT_STUDIO_RPC;
  readonly requests: ProjectStudioRpc["requests"];
  readonly streams: ProjectStudioRpc["streams"];

  constructor(studio: Studio) {
    this.requests = studio;
    this.streams = studio;
  }
}
