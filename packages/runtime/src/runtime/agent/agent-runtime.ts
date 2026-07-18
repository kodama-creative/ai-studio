import type {
  AgentMessage,
  StreamFn,
  ThinkingLevel
} from "@earendil-works/pi-agent-core";
import type { Models } from "@earendil-works/pi-ai";

import { assertValidAgentProject } from "./assert-valid-agent-project";
import { createImmutableAgentProjectSnapshot } from "./create-immutable-agent-project-snapshot";
import { prepareProjectTool } from "./prepare-project-tool";
import { resolveAgentRuntimeModel } from "./resolve-model";
import { STRUCTURED_OUTPUT_TOOL_NAME } from "../../shared/structured-output";
import {
  assertMaxStructuredOutputBytes,
  DEFAULT_MAX_STRUCTURED_OUTPUT_BYTES
} from "../outputs/structured-output-size";
import {
  AgentSession,
  type AgentSessionPersistence
} from "../sessions/agent-session";

import type {
  AgentProjectSnapshot
} from "./agent-project-snapshot";
import type { PreparedAgentTool } from "./prepared-agent-tool";
import type { AgentCapabilityPolicy } from "../../shared/agent-capability-policy";
import type {
  AgentModelOptionsDefinition,
  AgentModelSelector
} from "../../shared/agent-definition";
import type { AgentSessionContext } from "../../shared/agent-session-context";
import type { RuntimeExecutionMode } from "../../shared/runtime-execution-mode";
import type { SessionStore, StoredRuntimeSession } from "../harness/session-store";

export interface AgentRuntimeOptions {
  maxStructuredOutputBytes?: number;
  models: Models;
  project: AgentProjectSnapshot;
}

export interface CreateAgentSessionOptions {
  id?: string;
  context: AgentSessionContext;
  capabilityPolicy: AgentCapabilityPolicy;
  model?: AgentModelSelector;
  modelOptions?: AgentModelOptionsDefinition;
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
  outputContract?: string;
}

export class AgentRuntime {
  private readonly _models: Models;
  private readonly _project: AgentProjectSnapshot;
  private readonly _maxStructuredOutputBytes: number;

  constructor(options: AgentRuntimeOptions) {
    this._models = options.models;
    this._maxStructuredOutputBytes = assertMaxStructuredOutputBytes(
      options.maxStructuredOutputBytes ?? DEFAULT_MAX_STRUCTURED_OUTPUT_BYTES
    );
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

  get models(): Models {
    return this._models;
  }

  get maxStructuredOutputBytes(): number {
    return this._maxStructuredOutputBytes;
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
    const allTools = [
      ...this._project.tools.map(tool => prepareProjectTool(tool)),
      ...(options.extraTools ?? [])
    ];
    if (allTools.some(tool =>
      tool.definition.name === STRUCTURED_OUTPUT_TOOL_NAME)) {
      throw new Error(
        `Runtime tool name "${STRUCTURED_OUTPUT_TOOL_NAME}" is reserved for structured output`
      );
    }
    const outputDefinition = options.outputContract
      ? this._project.outputDefinitions?.find(
        output => output.name === options.outputContract
      )
      : undefined;
    if (options.outputContract && !outputDefinition) {
      throw new TypeError(
        `Unknown structured output contract: ${options.outputContract}`
      );
    }
    const session = new AgentSession({
      id: sessionId,
      models: this._models,
      project: this._project,
      model: resolveAgentRuntimeModel(this._models, selector),
      modelSelector: selector,
      reasoning,
      initialMessages: options.initialMessages ?? [],
      tools: allTools,
      activeToolNames: options.activeToolNames,
      capabilityPolicy: options.capabilityPolicy,
      capabilityRequest: {
        ...(options.model ? { model: options.model } : {}),
        ...(Object.hasOwn(options, "reasoning")
          ? { reasoning: options.reasoning }
          : {}),
        ...(options.modelOptions ? { modelOptions: options.modelOptions } : {}),
        ...(options.activeToolNames
          ? { activeToolNames: options.activeToolNames }
          : {})
      },
      instructionsPrefix: options.instructionsPrefix ?? "",
      systemPrompt: options.systemPrompt,
      executionMode: options.executionMode ?? "react",
      context: options.context,
      sessionStore: options.sessionStore,
      onSessionCommitted: options.onSessionCommitted,
      persistence: options.persistence,
      streamFn: options.streamFn,
      outputDefinition,
      maxStructuredOutputBytes: this._maxStructuredOutputBytes
    });
    await session.validateState();
    await session.prepareTurn();
    return session;
  }
}
