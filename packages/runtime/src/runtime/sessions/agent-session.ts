import {
  Agent,
  type AgentMessage,
  type BeforeToolCallContext,
  type StreamFn,
  type ThinkingLevel
} from "@earendil-works/pi-agent-core";
import { Compile } from "typebox/compile";

import type {
  Api,
  Model,
  Models,
  SimpleStreamOptions,
  ToolResultMessage
} from "@earendil-works/pi-ai";

import { AgentEventProjector, type AgentSessionEvent, type AgentSessionPersistence } from "../../execution/agent-event-projector";
import { ToolExecutionPolicy } from "../../execution/tool-execution-policy";
import { STRUCTURED_OUTPUT_TOOL_NAME } from "../../shared/structured-output";
import { resolveAgentRuntimeModel } from "../agent/resolve-model";
import {
  type AgentCapabilityRequest,
  AgentSessionCapabilities
} from "../capabilities/agent-session-capabilities";
import { AgentSessionInstructions } from "../instructions/agent-session-instructions";
import {
  createStructuredOutputTool
} from "../outputs/create-structured-output-tool";
import { StructuredOutputError } from "../outputs/structured-output-error";
import { DEFAULT_MAX_STRUCTURED_OUTPUT_BYTES } from "../outputs/structured-output-size";
import { AgentSessionState } from "../state/agent-session-state";

import type { AgentCapabilityPolicy } from "../../shared/agent-capability-policy";
import type {
  AgentModelOptionsDefinition,
  AgentModelSelector
} from "../../shared/agent-definition";
import type { AgentSessionContext } from "../../shared/agent-session-context";
import type { RuntimeExecutionMode } from "../../shared/runtime-execution-mode";
import type {
  AgentProjectSnapshot,
  CompiledAgentOutputDefinition
} from "../agent/agent-project-snapshot";
import type { PreparedAgentTool } from "../agent/prepared-agent-tool";
import type { RuntimeStructuredOutputResult } from "../harness/runtime-run";
import type {
  RuntimeTurnCapabilitySnapshot,
  RuntimeTurnInstructionSnapshot,
  SessionStore,
  StoredRuntimeSession
} from "../harness/session-store";

export type { AgentSessionEvent, AgentSessionPersistence };

export interface AgentSessionOptions {
  id?: string;
  models: Models;
  project: AgentProjectSnapshot;
  model: Model<Api>;
  modelSelector: AgentModelSelector;
  reasoning?: ThinkingLevel;
  initialMessages: AgentMessage[];
  tools: PreparedAgentTool[];
  activeToolNames?: string[];
  capabilityPolicy: AgentCapabilityPolicy;
  capabilityRequest: AgentCapabilityRequest;
  instructionsPrefix: string;
  systemPrompt?: string;
  executionMode: RuntimeExecutionMode;
  context: AgentSessionContext;
  sessionStore?: SessionStore;
  onSessionCommitted?: (session: StoredRuntimeSession) => Promise<void> | void;
  persistence?: AgentSessionPersistence;
  streamFn?: StreamFn;
  outputDefinition?: CompiledAgentOutputDefinition;
  maxStructuredOutputBytes?: number;
}

export class AgentSession {
  private readonly _agent: Agent;
  private readonly _project: AgentProjectSnapshot;
  private _modelSelector: AgentModelSelector;
  private _reasoning?: ThinkingLevel;
  private readonly _toolPolicy: ToolExecutionPolicy;
  private readonly _eventProjector: AgentEventProjector;
  private readonly _sessionState: AgentSessionState;
  private readonly _instructions: AgentSessionInstructions;
  private readonly _capabilities: AgentSessionCapabilities;
  private readonly _models: Models;
  private readonly _sessionStore?: SessionStore;
  private readonly _onSessionCommitted?: (
    session: StoredRuntimeSession
  ) => Promise<void> | void;

  private _modelOptions: AgentModelOptionsDefinition = {};
  private _capabilitySnapshot: RuntimeTurnCapabilitySnapshot | null = null;
  private _instructionSnapshot: RuntimeTurnInstructionSnapshot | null = null;
  private _resolvedWithoutSessionStore = false;
  private _terminalError: Error | null = null;
  private _executionMode: RuntimeExecutionMode;
  private readonly _outputTool?: PreparedAgentTool;
  private readonly _outputValidator?: ReturnType<typeof Compile>;
  private _structuredOutput: RuntimeStructuredOutputResult | null = null;

  constructor(options: AgentSessionOptions) {
    this._project = options.project;
    this._models = options.models;
    this._sessionStore = options.sessionStore;
    this._onSessionCommitted = options.onSessionCommitted;
    this._modelSelector = options.modelSelector;
    this._reasoning = options.reasoning;
    this._executionMode = options.executionMode;
    this._outputTool = options.outputDefinition
      ? createStructuredOutputTool({
        definition: options.outputDefinition,
        maxBytes: options.maxStructuredOutputBytes
          ?? DEFAULT_MAX_STRUCTURED_OUTPUT_BYTES,
        onFailure: error => { this._terminalError = error; },
        onResult: result => { this._structuredOutput = result; }
      })
      : undefined;
    this._outputValidator = options.outputDefinition
      ? Compile(options.outputDefinition.schema)
      : undefined;
    this._sessionState = new AgentSessionState({
      context: options.context,
      definitions: options.project.stateDefinitions ?? [],
      sessionStore: options.sessionStore,
      onCommitted: options.onSessionCommitted
    });
    this._instructions = new AgentSessionInstructions({
      context: this._sessionState.context,
      instructionsPrefix: options.instructionsPrefix,
      onCommitted: options.onSessionCommitted,
      project: options.project,
      sessionState: this._sessionState,
      sessionStore: options.sessionStore,
      systemPrompt: options.systemPrompt
    });
    const stateScopedTools = options.tools.map(tool => (tool.kind === "executable"
      ? {
        ...tool,
        execute: async (...args: Parameters<typeof tool.execute>) =>
          this._sessionState.executeTool(async () => tool.execute(...args))
      }
      : tool));
    this._capabilities = new AgentSessionCapabilities({
      context: options.context,
      models: options.models,
      policy: options.capabilityPolicy,
      project: options.project,
      request: options.capabilityRequest,
      sessionStoreAvailable: Boolean(options.sessionStore),
      sessionState: this._sessionState,
      tools: stateScopedTools
    });
    this._toolPolicy = new ToolExecutionPolicy({
      tools: stateScopedTools,
      activeToolNames: undefined
    });
    this._agent = new Agent({
      sessionId: options.id,
      initialState: {
        systemPrompt: "",
        model: options.model,
        thinkingLevel: options.reasoning ?? "off",
        messages: this._toolPolicy.restoreDeferredPlaceholders(
          options.initialMessages,
          options.executionMode
        ),
        tools: this._toolPolicy.toolsForMode(options.executionMode)
      },
      streamFn: async (model, context, streamOptions) => {
        const resolvedOptions = {
          ...streamOptions,
          ...this._modelOptions
        } as SimpleStreamOptions;
        return options.streamFn
          ? options.streamFn(model, context, resolvedOptions)
          : options.models.streamSimple(model, context, resolvedOptions);
      },
      beforeToolCall: async context => this._beforeToolCall(context),
      prepareNextTurnWithContext: async ({ toolResults }) => {
        try {
          if (
            this._outputTool
            && toolResults.some(result =>
              result.toolName === STRUCTURED_OUTPUT_TOOL_NAME)
            && !this._structuredOutput
          ) {
            if (!this._terminalError) {
              this._terminalError = new StructuredOutputError(
                "structured_output_invalid",
                "The selected structured output was invalid"
              );
            }
            throw this._terminalError;
          }
          await this._sessionState.completeStep(toolResults, {
            deferred: toolResults.some(result =>
              this._toolPolicy.isDeferredToolResult(result))
          });
          return undefined;
        } catch (error) {
          this._terminalError = error instanceof Error
            ? error
            : new Error(String(error));
          throw error;
        }
      }
    });
    this._eventProjector = new AgentEventProjector(
      () => this._executionMode,
      this._toolPolicy,
      () => this.messages,
      options.persistence
    );
    this._agent.subscribe(async event => this._eventProjector.handle(event));
  }

  get project(): AgentProjectSnapshot {
    return this._project;
  }

  get model(): AgentModelSelector {
    return this._modelSelector;
  }

  get reasoning(): ThinkingLevel | undefined {
    return this._reasoning;
  }

  get executionMode(): RuntimeExecutionMode {
    return this._executionMode;
  }

  get messages(): AgentMessage[] {
    return this._toolPolicy.publicMessages(this._agent.state.messages);
  }

  get instructionSnapshot(): RuntimeTurnInstructionSnapshot | null {
    return this._instructionSnapshot;
  }

  get capabilitySnapshot(): RuntimeTurnCapabilitySnapshot | null {
    return this._capabilitySnapshot;
  }

  get structuredOutput(): RuntimeStructuredOutputResult | null {
    return this._structuredOutput;
  }

  async prepareTurn(): Promise<void> {
    await this.validateState();
    await this._resolveTurnSetup();
  }

  async validateState(): Promise<void> {
    if (this._executionMode === "manual") { return; }
    await this._sessionState.validateSession();
  }

  setExecutionMode(mode: RuntimeExecutionMode): void {
    if (this._agent.state.isStreaming) {
      throw new Error(
        "Cannot change execution mode while the session is running"
      );
    }
    this._executionMode = mode;
    this._agent.state.tools = this._toolPolicy.toolsForMode(mode);
  }

  async prompt(message: AgentMessage | AgentMessage[] | string): Promise<void> {
    this._terminalError = null;
    this._structuredOutput = null;
    await this.validateState();
    await this._resolveTurnSetup();
    await this._agent.prompt(message as AgentMessage | AgentMessage[]);
    this._assertStructuredOutputCompleted();
    this._throwTerminalError();
  }

  async resolveToolResults(results: ToolResultMessage[]): Promise<void> {
    if (this._agent.state.isStreaming) {
      throw new Error(
        "Cannot resolve tool results while the session is running"
      );
    }
    this._agent.state.messages = this._toolPolicy.replaceDeferredResults(
      this._agent.state.messages,
      results
    );
    await this._eventProjector.handleToolResultsResolved();
  }

  async continue(): Promise<void> {
    this._terminalError = null;
    this._structuredOutput = null;
    await this.validateState();
    await this._resolveTurnSetup();
    await this._agent.continue();
    this._assertStructuredOutputCompleted();
    this._throwTerminalError();
  }

  abort(): void {
    this._sessionState.discardStep();
    this._agent.abort();
  }

  async waitForIdle(): Promise<void> {
    return this._agent.waitForIdle();
  }

  subscribe(
    listener: (event: AgentSessionEvent) => Promise<void> | void
  ): () => void {
    return this._eventProjector.subscribe(listener);
  }

  private _throwTerminalError(): void {
    const error = this._terminalError;
    this._terminalError = null;
    if (error) { throw error; }
  }

  private async _beforeToolCall(
    context: BeforeToolCallContext
  ): Promise<{ block: true; reason: string; } | undefined> {
    const calls = context.assistantMessage.content.filter(
      content => content.type === "toolCall"
    );
    const finalCalls = calls.filter(
      call => call.name === STRUCTURED_OUTPUT_TOOL_NAME
    );
    if (finalCalls.length === 0) { return undefined; }
    if (finalCalls.length !== 1 || calls.length !== 1) {
      const error = new StructuredOutputError(
        "structured_output_invalid",
        "final_output must be called exactly once and without sibling tools"
      );
      this._terminalError = error;
      return { block: true, reason: error.message };
    }
    if (!this._outputValidator?.Check(finalCalls[0]?.arguments)) {
      const error = new StructuredOutputError(
        "structured_output_invalid",
        "final_output arguments do not match the selected contract"
      );
      this._terminalError = error;
      return { block: true, reason: error.message };
    }
    return undefined;
  }

  private _assertStructuredOutputCompleted(): void {
    if (!this._outputTool || this._structuredOutput || this._terminalError) {
      return;
    }
    const last = this._agent.state.messages.at(-1);
    if (
      last?.role === "assistant"
      && (last.stopReason === "aborted" || last.stopReason === "error")
    ) {
      return;
    }
    this._terminalError = new StructuredOutputError(
      "structured_output_missing",
      "The model completed without the selected structured output"
    );
  }

  private async _resolveTurnSetup(): Promise<void> {
    if (!this._sessionStore && this._resolvedWithoutSessionStore) { return; }
    const stateScopeEnabled = this._executionMode !== "manual";
    const stored = this._sessionStore
      ? await this._sessionStore.load(this._sessionState.context.id)
      : null;
    const [instructionSnapshot, capabilities] = await Promise.all([
      this._instructions.prepare(stateScopeEnabled, stored),
      this._capabilities.prepare(stateScopeEnabled, stored)
    ]);
    let committed = stored;
    const mutations = [];
    if (!stored?.snapshot.instructionSnapshots?.[
      this._sessionState.context.turn.id
    ]) {
      mutations.push({
        type: "recordTurnInstructions" as const,
        snapshot: instructionSnapshot
      });
    }
    if (!stored?.snapshot.capabilitySnapshots?.[
      this._sessionState.context.turn.id
    ]) {
      mutations.push({
        type: "recordTurnCapabilities" as const,
        snapshot: capabilities.snapshot
      });
    }
    if (this._sessionStore && mutations.length > 0) {
      committed = await this._sessionStore.commit({
        sessionId: this._sessionState.context.id,
        expectedVersion: stored?.version ?? null,
        mutations
      });
      await this._onSessionCommitted?.(committed);
    }
    this._instructionSnapshot = committed?.snapshot.instructionSnapshots?.[
      this._sessionState.context.turn.id
    ] ?? instructionSnapshot;
    this._capabilitySnapshot = committed?.snapshot.capabilitySnapshots?.[
      this._sessionState.context.turn.id
    ] ?? capabilities.snapshot;
    this._modelSelector = capabilities.model;
    this._reasoning = capabilities.reasoning;
    this._modelOptions = capabilities.modelOptions;
    if (capabilities.tools.some(tool =>
      tool.definition.name === STRUCTURED_OUTPUT_TOOL_NAME)) {
      throw new Error(
        `Runtime tool name "${STRUCTURED_OUTPUT_TOOL_NAME}" is reserved for structured output`
      );
    }
    this._toolPolicy.configure({
      tools: this._outputTool
        ? [...capabilities.tools, this._outputTool]
        : capabilities.tools
    });
    this._agent.state.model = resolveAgentRuntimeModel(
      this._models,
      capabilities.model
    );
    this._agent.state.thinkingLevel = capabilities.reasoning ?? "off";
    this._agent.state.tools = this._toolPolicy.toolsForMode(this._executionMode);
    this._agent.state.systemPrompt = this._instructionSnapshot.markdown;
    this._resolvedWithoutSessionStore = !this._sessionStore;
  }
}
