import type { ModelManager } from "@llm-space/runtime/models";
import type { SkillsManager } from "@llm-space/runtime/skills";
import { createStudio, type Studio } from "@llm-space/studio/server";
import { ContainerModule, type ResolutionContext } from "inversify";

import type { AgentProjectView } from "../../shared/agent-project";
import {
  RpcContribution,
  type RpcContribution as RpcContributionApi,
} from "../di/rpc-contribution";
import type { RpcRegistry } from "../di/rpc-registry";
import {
  desktopToken,
} from "../di/tokens";
import { MODEL_MANAGER } from "../models/models-module";
import { WINDOW_CONTEXT } from "../native/native-window-module";
import { SKILLS_MANAGER } from "../skills/skills-module";
import { StudioThreadRpcServer } from "../thread/thread-rpc-server";

import type { AgentProject } from "./agent-project";
import {
  ProjectSourceRpcServer,
  StudioRpcServer,
} from "./project-rpc-server";
import { ProjectSandbox } from "./project-sandbox";

export const PROJECT_SOURCE = desktopToken<AgentProject>(
  "project-window",
  "source"
);
export const PROJECT_VIEW = desktopToken<AgentProjectView>(
  "project-window",
  "project"
);
export const PROJECT_STUDIO = desktopToken<Studio>(
  "project-window",
  "studio"
);

/** Bind one Project Studio from its source and process-owned runtime managers. */
export function projectWindowModule(input: {
  readonly source: AgentProject;
}): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(PROJECT_SOURCE).toConstantValue(input.source);
    bind(PROJECT_STUDIO)
      .toDynamicValue(async (context: ResolutionContext) => {
        const source = context.get<AgentProject>(PROJECT_SOURCE);
        const modelManager = context.get<ModelManager>(
          MODEL_MANAGER
        );
        const skillsManager = context.get<SkillsManager>(
          SKILLS_MANAGER
        );
        return createStudio({
          projectRoot: source.rootPath,
          dataRoot: source.studioStateRoot,
          models: () => modelManager.getAvailableModels(),
          resolveConnection: ({ providerId }) =>
            modelManager.resolveConnection({ providerId }),
          runtimeServices: {
            sandbox: new ProjectSandbox(source.rootPath),
            skills: {
              resolve({ identifier }) {
                const skill = skillsManager.findSkill(identifier);
                if (skill === null) {
                  throw new Error(`Skill "${identifier}" is not available.`);
                }
                const name = skill.frontmatters.name;
                const description = skill.frontmatters.description;
                if (
                  typeof name !== "string" ||
                  typeof description !== "string"
                ) {
                  throw new Error(
                    `Skill "${identifier}" has invalid frontmatter.`
                  );
                }
                return { name, description, markdown: skill.content };
              },
            },
          },
        }).then((studio) =>
          Object.assign(studio, { dispose: () => studio.close() })
        );
      })
      .inSingletonScope();
  });
}

/** Bind renderer identity only after Studio reveals the loaded Agent ids. */
export function projectWindowIdentityModule(
  project: AgentProjectView
): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(WINDOW_CONTEXT).toConstantValue({
      kind: "agentProject",
      project,
    });
    bind(PROJECT_VIEW).toConstantValue(project);
  });
}

class ProjectContribution implements RpcContributionApi {
  constructor(
    private readonly _studio: Studio,
    private readonly _projectId: string
  ) {}

  registerRpc(rpc: RpcRegistry): void {
    rpc.registerServer(new ProjectSourceRpcServer(this._studio));
    rpc.registerServer(new StudioRpcServer(this._studio));
    rpc.registerServer(
      new StudioThreadRpcServer(this._studio, this._projectId)
    );
  }
}

/** Bind Project-only Studio transport adapters in the window scope. */
export function projectContributionsModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(ProjectContribution)
      .toDynamicValue(
        (context) =>
          new ProjectContribution(
            context.get(PROJECT_STUDIO),
            context.get<AgentProjectView>(PROJECT_VIEW).id
          )
      )
      .inSingletonScope();
    bind<RpcContributionApi>(RpcContribution).toService(ProjectContribution);
  });
}
