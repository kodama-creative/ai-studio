import { ContainerModule, type ResolutionContext } from "inversify";

import { createProjectSourceClient } from "@/client/project-source-client";
import { createStudioClient } from "@/client/studio-client";
import type { AgentProjectView } from "@/shared/agent-project";
import type { ProjectSourceTransport } from "@/shared/project-source-rpc";
import type { StudioTransport } from "@/shared/studio-rpc";

import { ProjectSourceController } from "../project/project-source-controller";
import { ProjectThreadsController } from "../project/project-threads-controller";
import { ProjectWorkspaceController } from "../project/project-workspace-controller";

import { RENDERER_EVENTS } from "./common-module";
import { RENDERER_LIFECYCLE_CONTRIBUTION } from "./lifecycle";
import { rendererToken, resolveRenderer } from "./tokens";

export const AGENT_PROJECT_VIEW = rendererToken<AgentProjectView>(
  "project",
  "view"
);
export const STUDIO_CLIENT = rendererToken<StudioTransport>(
  "project",
  "studio-client"
);
export const PROJECT_SOURCE_CLIENT = rendererToken<ProjectSourceTransport>(
  "project",
  "source-client"
);
export const PROJECT_WORKSPACE_CONTROLLER =
  rendererToken<ProjectWorkspaceController>("project", "workspace-controller");
const PROJECT_THREADS_CONTROLLER = rendererToken<ProjectThreadsController>(
  "project",
  "threads-controller"
);
const PROJECT_SOURCE_CONTROLLER = rendererToken<ProjectSourceController>(
  "project",
  "source-controller"
);

export function rendererProjectWindowModule(
  project: AgentProjectView
): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(AGENT_PROJECT_VIEW).toConstantValue(project);
    bind(STUDIO_CLIENT).toConstantValue(createStudioClient());
    bind(PROJECT_SOURCE_CLIENT).toConstantValue(createProjectSourceClient());
    bind(PROJECT_THREADS_CONTROLLER)
      .toDynamicValue((context: ResolutionContext) => {
        const events = resolveRenderer(context, RENDERER_EVENTS);
        return new ProjectThreadsController({
          client: resolveRenderer(context, STUDIO_CLIENT),
          reportError: (title, error) =>
            events.emit("notification:error", title, error),
        });
      })
      .inSingletonScope();
    bind(PROJECT_SOURCE_CONTROLLER)
      .toDynamicValue((context: ResolutionContext) => {
        const events = resolveRenderer(context, RENDERER_EVENTS);
        return new ProjectSourceController({
          client: resolveRenderer(context, PROJECT_SOURCE_CLIENT),
          reportError: (title, error) =>
            events.emit("notification:error", title, error),
        });
      })
      .inSingletonScope();
    bind(PROJECT_WORKSPACE_CONTROLLER)
      .toDynamicValue(
        (context: ResolutionContext) =>
          new ProjectWorkspaceController(
            resolveRenderer(context, PROJECT_THREADS_CONTROLLER),
            resolveRenderer(context, PROJECT_SOURCE_CONTROLLER)
          )
      )
      .inSingletonScope();
    bind(RENDERER_LIFECYCLE_CONTRIBUTION).toService(
      PROJECT_WORKSPACE_CONTROLLER
    );
  });
}
