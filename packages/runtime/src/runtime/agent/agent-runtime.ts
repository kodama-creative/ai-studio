import type {
  AgentMessage,
  AgentTool,
  StreamFn,
  ThinkingLevel,
} from "@earendil-works/pi-agent-core";
import type { Models } from "@earendil-works/pi-ai";

import type { AgentModelSelector } from "../../shared/agent-definition";
import type { RuntimeExecutionMode } from "../../shared/runtime-execution";
import {
  AgentSession,
  type AgentSessionPersistence,
} from "../sessions/agent-session";

import { type AgentProjectSnapshot } from "./agent-project";
import { assertValidAgentProject } from "./assert-valid-agent-project";
import { createImmutableAgentProjectSnapshot } from "./create-immutable-agent-project-snapshot";
import type { PreparedAgentTool } from "./prepared-tool";
import { resolveAgentRuntimeModel } from "./resolve-model";

export interface AgentRuntimeOptions {
  models: Models;
  project: AgentProjectSnapshot;
}

export interface CreateAgentSessionOptions {
  id?: string;
  model?: AgentModelSelector;
  reasoning?: ThinkingLevel;
  initialMessages?: AgentMessage[];
  extraTools?: PreparedAgentTool[];
  activeToolNames?: string[];
  instructionsPrefix?: string;
  systemPrompt?: string;
  executionMode?: RuntimeExecutionMode;
  persistence?: AgentSessionPersistence;
  streamFn?: StreamFn;
}

export class AgentRuntime {
  private readonly _models: Models;
  private readonly _project: AgentProjectSnapshot;

  constructor(options: AgentRuntimeOptions) {
    this._models = options.models;
    this._project = createImmutableAgentProjectSnapshot(
      assertValidAgentProject(options.project)
    );
    if (!this._project.definition) {
      throw new Error("Agent project has no compiled definition");
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
    options: CreateAgentSessionOptions = {}
  ): Promise<AgentSession> {
    const selector = options.model ?? this._project.definition!.model;
    const reasoning = Object.hasOwn(options, "reasoning")
      ? options.reasoning
      : this._project.definition!.reasoning;
    return Promise.resolve(
      new AgentSession({
        id: options.id,
        models: this._models,
        project: this._project,
        model: resolveAgentRuntimeModel(this._models, selector),
        modelSelector: selector,
        reasoning,
        initialMessages: options.initialMessages ?? [],
        tools: [
          ...this._project.tools.map(_prepareProjectTool),
          ...(options.extraTools ?? []),
        ],
        activeToolNames: options.activeToolNames,
        instructionsPrefix: options.instructionsPrefix ?? "",
        systemPrompt: options.systemPrompt,
        executionMode: options.executionMode ?? "react",
        persistence: options.persistence,
        streamFn: options.streamFn,
      })
    );
  }
}

function _prepareProjectTool(tool: AgentTool): PreparedAgentTool {
  const { execute, ...definition } = tool;
  return {
    kind: "executable",
    definition,
    async execute(...args) {
      return { type: "completed", result: await execute(...args) };
    },
  };
}
