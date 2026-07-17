import type {
  AgentMessage,
  AgentTool,
  StreamFn,
  ThinkingLevel
} from "@earendil-works/pi-agent-core";
import type { Models } from "@earendil-works/pi-ai";

import { assertValidAgentProject } from "./assert-valid-agent-project";
import { createImmutableAgentProjectSnapshot } from "./create-immutable-agent-project-snapshot";
import { resolveAgentRuntimeModel } from "./resolve-model";
import {
  AgentSession,
  type AgentSessionPersistence
} from "../sessions/agent-session";

import type { AgentProjectSnapshot } from "./agent-project-snapshot";
import type { PreparedAgentTool } from "./prepared-agent-tool";
import type { AgentModelSelector } from "../../shared/agent-definition";
import type { AgentSessionContext } from "../../shared/agent-session-context";
import type { RuntimeExecutionMode } from "../../shared/runtime-execution-mode";
import type { SessionStore, StoredRuntimeSession } from "../harness/session-store";

export interface AgentRuntimeOptions {
  models: Models;
  project: AgentProjectSnapshot;
}

export interface CreateAgentSessionOptions {
  id?: string;
  context: AgentSessionContext;
  model?: AgentModelSelector;
  reasoning?: ThinkingLevel;
  initialMessages?: AgentMessage[];
  extraTools?: PreparedAgentTool[];
  activeToolNames?: string[];
  instructionsPrefix?: string;
  systemPrompt?: string;
  executionMode?: RuntimeExecutionMode;
  persistence?: AgentSessionPersistence;
  sessionStore?: SessionStore;
  onSessionCommitted?: (session: StoredRuntimeSession) => Promise<void> | void;
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
    available: boolean;
    selector: AgentModelSelector;
  } {
    const definition = this._project.definition;
    if (!definition) {
      throw new Error("Agent runtime definition is unavailable");
    }
    const selector = definition.model;
    return {
      selector,
      available: Boolean(this._models.getModel(selector.provider, selector.id))
    };
  }

  async createSession(
    options: CreateAgentSessionOptions
  ): Promise<AgentSession> {
    if (!options?.context) {
      throw new Error(
        "Agent Runtime Sessions require Host-verified Session context"
      );
    }
    const definition = this._project.definition;
    if (!definition) {
      throw new Error("Agent runtime definition is unavailable");
    }
    const selector = options.model ?? definition.model;
    const reasoning = Object.hasOwn(options, "reasoning")
      ? options.reasoning
      : definition.reasoning;
    const sessionId = options.context.id;
    if (options.id && options.id !== options.context.id) {
      throw new Error("Agent Session id must match the verified Session context");
    }
    const session = new AgentSession({
      id: sessionId,
      models: this._models,
      project: this._project,
      model: resolveAgentRuntimeModel(this._models, selector),
      modelSelector: selector,
      reasoning,
      initialMessages: options.initialMessages ?? [],
      tools: [
        ...this._project.tools.map(_prepareProjectTool),
        ...(options.extraTools ?? [])
      ],
      activeToolNames: options.activeToolNames,
      instructionsPrefix: options.instructionsPrefix ?? "",
      systemPrompt: options.systemPrompt,
      executionMode: options.executionMode ?? "react",
      context: options.context,
      sessionStore: options.sessionStore,
      onSessionCommitted: options.onSessionCommitted,
      persistence: options.persistence,
      streamFn: options.streamFn
    });
    await session.validateState();
    return session;
  }
}

function _prepareProjectTool(tool: AgentTool): PreparedAgentTool {
  const { execute, ...definition } = tool;
  return {
    kind: "executable",
    definition,
    async execute(...args) {
      return { type: "completed", result: await execute(...args) };
    }
  };
}
