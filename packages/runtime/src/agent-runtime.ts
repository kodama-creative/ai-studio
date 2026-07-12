import {
  type AgentTool,
  type ExecutionEnv,
  type Session,
  type ThinkingLevel,
} from "@earendil-works/pi-agent-core";
import type { Api, Model, Models } from "@earendil-works/pi-ai";

import { AgentRuntimeSession } from "./agent-runtime-session";
import { assertValidAgentProject, type AgentProjectSnapshot } from "./project";

export interface AgentModelSelector {
  provider: string;
  id: string;
}

export interface AgentRuntimeOptions {
  env: ExecutionEnv;
  models: Models;
}

export interface CreateAgentRuntimeSessionOptions {
  session: Session;
  model: AgentModelSelector;
  loadProject: () => Promise<AgentProjectSnapshot>;
  extraTools?: AgentTool[];
  instructionsPrefix?: string;
  thinkingLevel?: ThinkingLevel;
  allowInvalidProject?: boolean;
}

export class AgentRuntime {
  private readonly _env: ExecutionEnv;
  private readonly _models: Models;

  constructor(options: AgentRuntimeOptions) {
    this._env = options.env;
    this._models = options.models;
  }

  async createSession(
    options: CreateAgentRuntimeSessionOptions
  ): Promise<AgentRuntimeSession> {
    const model = this._resolveModel(options.model);
    const loaded = await options.loadProject();
    const snapshot = options.allowInvalidProject
      ? loaded
      : assertValidAgentProject(loaded);
    return new AgentRuntimeSession({
      env: this._env,
      models: this._models,
      session: options.session,
      model,
      loadProject: options.loadProject,
      snapshot,
      extraTools: options.extraTools ?? [],
      instructionsPrefix: options.instructionsPrefix ?? "",
      thinkingLevel: options.thinkingLevel,
      allowInvalidProject: options.allowInvalidProject ?? false,
    });
  }

  private _resolveModel(selector: AgentModelSelector): Model<Api> {
    const model = this._models.getModel(selector.provider, selector.id);
    if (!model) {
      throw new Error(
        `Model "${selector.provider}/${selector.id}" is not available`
      );
    }
    return model;
  }
}
