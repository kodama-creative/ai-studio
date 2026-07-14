import type {
  AgentMessage,
  AgentTool,
  StreamFn,
  ThinkingLevel,
} from "@earendil-works/pi-agent-core";
import type { Api, Model, Models } from "@earendil-works/pi-ai";

import type { AgentModelSelector } from "./agent-definition";
import { AgentRuntimeModelUnavailableError } from "./agent-runtime-model-unavailable-error";
import {
  AgentRuntimeSession,
  type AgentRuntimeSessionPersistence,
  type RuntimeExecutionMode,
} from "./agent-runtime-session";
import { createImmutableAgentProjectSnapshot } from "./immutable-agent-project-snapshot";
import { assertValidAgentProject, type AgentProjectSnapshot } from "./project";

export interface AgentRuntimeOptions {
  models: Models;
  project: AgentProjectSnapshot;
}

export interface BuildAgentRuntimeOptions {
  models: Models;
  loadProject: () => Promise<AgentProjectSnapshot>;
}

export interface CreateAgentRuntimeSessionOptions {
  id?: string;
  model?: AgentModelSelector;
  reasoning?: ThinkingLevel;
  initialMessages?: AgentMessage[];
  extraTools?: AgentTool[];
  activeToolNames?: string[];
  instructionsPrefix?: string;
  systemPrompt?: string;
  executionMode?: RuntimeExecutionMode;
  persistence?: AgentRuntimeSessionPersistence;
  streamFn?: StreamFn;
}

export class AgentRuntime {
  private readonly _models: Models;
  private readonly _project: AgentProjectSnapshot;

  static async create(
    options: BuildAgentRuntimeOptions
  ): Promise<AgentRuntime> {
    const project = assertValidAgentProject(await options.loadProject());
    if (!project.definition) {
      throw new Error("Agent project has no resolved definition");
    }
    return new AgentRuntime({ models: options.models, project });
  }

  constructor(options: AgentRuntimeOptions) {
    this._models = options.models;
    this._project = createImmutableAgentProjectSnapshot(
      assertValidAgentProject(options.project)
    );
    if (!this._project.definition) {
      throw new Error("Agent project has no resolved definition");
    }
  }

  get project(): AgentProjectSnapshot {
    return this._project;
  }

  get defaultModel(): {
    selector: AgentModelSelector;
    available: boolean;
  } {
    const selector = this._project.definition!.model;
    return {
      selector,
      available: Boolean(this._models.getModel(selector.provider, selector.id)),
    };
  }

  createSession(
    options: CreateAgentRuntimeSessionOptions = {}
  ): Promise<AgentRuntimeSession> {
    const selector = options.model ?? this._project.definition!.model;
    const model = this._resolveModel(selector);
    const reasoning = Object.hasOwn(options, "reasoning")
      ? options.reasoning
      : this._project.definition!.reasoning;
    return Promise.resolve(
      new AgentRuntimeSession({
        id: options.id,
        models: this._models,
        project: this._project,
        model,
        modelSelector: selector,
        reasoning,
        initialMessages: options.initialMessages ?? [],
        extraTools: options.extraTools ?? [],
        activeToolNames: options.activeToolNames,
        instructionsPrefix: options.instructionsPrefix ?? "",
        systemPrompt: options.systemPrompt,
        executionMode: options.executionMode ?? "react",
        persistence: options.persistence,
        streamFn: options.streamFn,
      })
    );
  }

  private _resolveModel(selector: AgentModelSelector): Model<Api> {
    const model = this._models.getModel(selector.provider, selector.id);
    if (!model) throw new AgentRuntimeModelUnavailableError(selector);
    return model;
  }
}
