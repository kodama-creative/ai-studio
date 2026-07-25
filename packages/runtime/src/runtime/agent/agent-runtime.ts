import type {
  AgentMessage,
  ExecutionEnv,
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
import { SandboxUnavailableError } from "../sandbox/sandbox-unavailable-error";
import {
  AgentSession,
  type AgentSessionPersistence
} from "../sessions/agent-session";

import type {
  AgentProjectSnapshot
} from "./agent-project-snapshot";
import type { PreparedAgentTool } from "./prepared-agent-tool";
import type { AgentHostApprovalPolicy } from "../../shared/agent-approval-policy";
import type { AgentCapabilityPolicy } from "../../shared/agent-capability-policy";
import type {
  AgentModelOptionsDefinition,
  AgentModelSelector
} from "../../shared/agent-definition";
import type { AgentSessionContext } from "../../shared/agent-session-context";
import type { RuntimeExecutionMode } from "../../shared/runtime-execution-mode";
import type { RuntimeCompactionPhase } from "../compaction/runtime-compaction-coordinator";
import type { SessionStore, StoredRuntimeSession } from "../harness/session-store";
import type { SandboxTurnEnvironment } from "../sandbox/sandbox-provider";

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
  modelConfigurationAuthority?: "agent" | "host";
  modelOptions?: AgentModelOptionsDefinition;
  reasoning?: ThinkingLevel;
  initialMessages?: AgentMessage[];
  extraTools?: PreparedAgentTool[];
  activeToolNames?: string[];
  approvalPolicy?: AgentHostApprovalPolicy;
  instructionsPrefix?: string;
  systemPrompt?: string;
  executionMode?: RuntimeExecutionMode;
  persistence?: AgentSessionPersistence;
  sessionStore?: SessionStore;
  onSessionCommitted?: (session: StoredRuntimeSession) => Promise<void> | void;
  onPhase?: (phase: RuntimeCompactionPhase) => void;
  streamFn?: StreamFn;
  outputContract?: string;
  executionEnv?: ExecutionEnv;
  sandbox?: SandboxTurnEnvironment;
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
    if (
      options.modelConfigurationAuthority !== undefined
      && options.modelConfigurationAuthority !== "agent"
      && options.modelConfigurationAuthority !== "host"
    ) {
      throw new TypeError("Invalid model configuration authority");
    }
    if (this._project.sandbox && !options.sandbox) {
      throw new SandboxUnavailableError();
    }
    const executionEnv = options.sandbox?.executionEnv ?? options.executionEnv;
    const reasoning = Object.hasOwn(options, "reasoning")
      ? options.reasoning
      : definition.reasoning;
    const sessionId = options.context.id;
    if (options.id && options.id !== options.context.id) {
      throw new Error("Agent Session id must match the verified Session context");
    }
    const allTools = [
      ...this._project.tools.map(tool => prepareProjectTool(
        tool,
        undefined,
        executionEnv
      )),
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
      approvalPolicy: options.approvalPolicy,
      capabilityPolicy: options.capabilityPolicy,
      capabilityRequest: {
        ...(options.model ? { model: options.model } : {}),
        ...(options.modelConfigurationAuthority
          ? {
            modelConfigurationAuthority:
              options.modelConfigurationAuthority
          }
          : {}),
        ...(Object.hasOwn(options, "reasoning")
          ? { reasoning: options.reasoning }
          : {}),
        ...(options.modelOptions ? { modelOptions: options.modelOptions } : {}),
        ...(options.activeToolNames
          ? { activeToolNames: options.activeToolNames }
          : {})
      },
      instructionsPrefix: options.instructionsPrefix ?? "",
      sandboxInstruction: options.sandbox
        ? _sandboxWorkspaceInstruction(options.sandbox.workspaceManifest)
        : undefined,
      systemPrompt: options.systemPrompt,
      executionMode: options.executionMode ?? "react",
      context: options.context,
      sessionStore: options.sessionStore,
      onSessionCommitted: options.onSessionCommitted,
      onPhase: options.onPhase,
      persistence: options.persistence,
      streamFn: options.streamFn,
      outputDefinition,
      maxStructuredOutputBytes: this._maxStructuredOutputBytes,
      ...(executionEnv ? { executionEnv } : {})
    });
    await session.validateState();
    await session.prepareTurn();
    return session;
  }
}

function _sandboxWorkspaceInstruction(
  manifest: readonly string[]
): string {
  const entries = [...manifest]
    .filter(entry => typeof entry === "string")
    .toSorted()
    .slice(0, 1_000)
    .map(entry => `- ${JSON.stringify(entry)}`);
  return [
    '<workspace path="/workspace">',
    ...entries,
    "</workspace>"
  ].join("\n");
}
