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
  PROCESS_TOKENS,
  PROJECT_WINDOW_TOKENS,
  WINDOW_TOKENS,
} from "../di/tokens";
import { StudioThreadRpcServer } from "../rpc/thread-rpc-server";

import type { AgentProject } from "./agent-project";
import { ProjectRpcServer } from "./project-rpc-server";
import { ProjectSandbox } from "./project-sandbox";

/** Bind one Project Studio from its source and process-owned runtime managers. */
export function projectWindowModule(input: {
  readonly source: AgentProject;
}): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(PROJECT_WINDOW_TOKENS.source).toConstantValue(input.source);
    bind(PROJECT_WINDOW_TOKENS.studio)
      .toDynamicValue(async (context: ResolutionContext) => {
        const source = context.get<AgentProject>(PROJECT_WINDOW_TOKENS.source);
        const modelManager = context.get<ModelManager>(
          PROCESS_TOKENS.modelManager
        );
        const skillsManager = context.get<SkillsManager>(
          PROCESS_TOKENS.skillsManager
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
    bind(WINDOW_TOKENS.context).toConstantValue({
      kind: "agentProject",
      project,
    });
    bind(PROJECT_WINDOW_TOKENS.project).toConstantValue(project);
  });
}

class ProjectContribution implements RpcContributionApi {
  constructor(
    private readonly _studio: Studio,
    private readonly _projectId: string
  ) {}

  registerRpc(rpc: RpcRegistry): void {
    rpc.registerServer(new ProjectRpcServer(this._studio));
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
            context.get(PROJECT_WINDOW_TOKENS.studio),
            context.get<AgentProjectView>(PROJECT_WINDOW_TOKENS.project).id
          )
      )
      .inSingletonScope();
    bind<RpcContributionApi>(RpcContribution).toService(ProjectContribution);
  });
}
