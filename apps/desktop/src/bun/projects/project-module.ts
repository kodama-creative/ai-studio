import { ModelManager } from "@llm-space/runtime/models";
import { createStudio, type Studio } from "@llm-space/studio/server";
import { ContainerModule, inject, injectable, preDestroy } from "inversify";

import type { AgentProjectView } from "../../shared/agent-project";
import {
  RpcContribution,
  type RpcContribution as RpcContributionApi,
} from "../di/rpc-contribution";
import type { RpcRegistry } from "../di/rpc-registry";
import {
  WINDOW_CONTEXT_PROVIDER,
  type WindowContextProvider,
} from "../native/native-window-module";
import { StudioAcpSessionRpcServer } from "../thread/acp-session-rpc-server";

import type { AgentProject } from "./agent-project";
import { PROJECT_SOURCE } from "./project-identifiers";
import { ProjectSourceRpcServer, StudioRpcServer } from "./project-rpc-server";
import { ProjectSandbox } from "./project-sandbox";
import { ProjectSkillService } from "./project-skill-service";

export { PROJECT_SOURCE } from "./project-identifiers";

/** Own one Project's source-derived Studio resource for the child lifetime. */
@injectable()
export class ProjectService implements WindowContextProvider {
  private _startPromise: Promise<void> | undefined;
  private _stopPromise: Promise<void> | undefined;
  private _studio: Studio | undefined;
  private _view: AgentProjectView | undefined;
  private _stopped = false;

  constructor(
    @inject(PROJECT_SOURCE) private readonly _source: AgentProject,
    @inject(ModelManager) private readonly _models: ModelManager,
    @inject(ProjectSandbox) private readonly _sandbox: ProjectSandbox,
    @inject(ProjectSkillService)
    private readonly _projectSkills: ProjectSkillService
  ) {}

  /** Open Studio and derive immutable renderer identity before RPC starts. */
  start(): Promise<void> {
    if (this._stopped) {
      return Promise.reject(new Error("Project Service is already stopped."));
    }
    this._startPromise ??= this._start();
    return this._startPromise;
  }

  /** Return the started Studio for Project RPC contributions. */
  get studio(): Studio {
    if (this._studio === undefined) {
      throw new Error("Project Service must start before Studio is used.");
    }
    return this._studio;
  }

  /** Return identity frozen from the source revision opened by Studio. */
  get projectView(): AgentProjectView {
    if (this._view === undefined) {
      throw new Error("Project Service must start before identity is used.");
    }
    return this._view;
  }

  getWindowContext() {
    return { kind: "agentProject", project: this.projectView } as const;
  }

  /** Close Studio exactly once; safe after partial startup failure. */
  @preDestroy()
  stop(): Promise<void> {
    this._stopPromise ??= this._stop();
    return this._stopPromise;
  }

  private async _start(): Promise<void> {
    const studio = await createStudio({
      projectRoot: this._source.rootPath,
      dataRoot: this._source.studioStateRoot,
      models: () => this._models.getAvailableModels(),
      resolveConnection: ({ providerId }) =>
        this._models.resolveConnection({ providerId }),
      runtimeServices: {
        sandbox: this._sandbox,
        skills: this._projectSkills,
      },
    });
    if (this._stopped) {
      await studio.close();
      throw new Error("Project Service stopped during startup.");
    }
    this._studio = studio;
    this._view = {
      id: this._source.id,
      name: this._source.name,
      rootPath: this._source.rootPath,
      agentRoot: this._source.agentRoot,
      agentId: studio.agent.agentSpecId,
      generationId: studio.agent.sourceRevision,
    };
  }

  private async _stop(): Promise<void> {
    this._stopped = true;
    await this._startPromise?.catch(() => undefined);
    const studio = this._studio;
    this._studio = undefined;
    this._view = undefined;
    await studio?.close();
  }
}

/** Bind one Project Studio from its source and process-owned runtime managers. */
export function projectWindowModule(input: {
  readonly source: AgentProject;
}): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(PROJECT_SOURCE).toConstantValue(input.source);
    bind(ProjectSandbox).toSelf().inSingletonScope();
    bind(ProjectSkillService).toSelf().inSingletonScope();
    bind(ProjectService).toSelf().inSingletonScope();
    bind(WINDOW_CONTEXT_PROVIDER).toService(ProjectService);
  });
}

@injectable()
class ProjectContribution implements RpcContributionApi {
  constructor(
    @inject(ProjectService) private readonly _project: ProjectService
  ) {}

  registerRpc(rpc: RpcRegistry): void {
    const studio = this._project.studio;
    rpc.registerServer(new ProjectSourceRpcServer(studio));
    rpc.registerServer(new StudioRpcServer(studio));
    rpc.registerServer(
      new StudioAcpSessionRpcServer(studio, this._project.projectView.id)
    );
  }
}

/** Bind Project-only Studio transport adapters in the window scope. */
export function projectContributionsModule(): ContainerModule {
  return new ContainerModule(({ bind }) => {
    bind(ProjectContribution).toSelf().inSingletonScope();
    bind<RpcContributionApi>(RpcContribution).toService(ProjectContribution);
  });
}
