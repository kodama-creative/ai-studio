import { Agent, type AgentMessage, type StreamFn, type ThinkingLevel } from "@earendil-works/pi-agent-core";

import type { Api, Model, Models, ToolResultMessage } from "@earendil-works/pi-ai";

import { AgentEventProjector, type AgentSessionEvent, type AgentSessionPersistence } from "../../execution/agent-event-projector";
import { ToolExecutionPolicy } from "../../execution/tool-execution-policy";
import { AgentSessionInstructions } from "../instructions/agent-session-instructions";
import { AgentSessionState } from "../state/agent-session-state";

import type { AgentModelSelector } from "../../shared/agent-definition";
import type { AgentSessionContext } from "../../shared/agent-session-context";
import type { RuntimeExecutionMode } from "../../shared/runtime-execution-mode";
import type { AgentProjectSnapshot } from "../agent/agent-project-snapshot";
import type { PreparedAgentTool } from "../agent/prepared-agent-tool";
import type {
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
  instructionsPrefix: string;
  systemPrompt?: string;
  executionMode: RuntimeExecutionMode;
  context: AgentSessionContext;
  sessionStore?: SessionStore;
  onSessionCommitted?: (session: StoredRuntimeSession) => Promise<void> | void;
  persistence?: AgentSessionPersistence;
  streamFn?: StreamFn;
}

export class AgentSession {
  private readonly _agent: Agent;
  private readonly _project: AgentProjectSnapshot;
  private readonly _modelSelector: AgentModelSelector;
  private readonly _reasoning?: ThinkingLevel;
  private readonly _toolPolicy: ToolExecutionPolicy;
  private readonly _eventProjector: AgentEventProjector;
  private readonly _sessionState: AgentSessionState;
  private readonly _instructions: AgentSessionInstructions;
  private _instructionSnapshot: RuntimeTurnInstructionSnapshot | null = null;
  private _terminalError: Error | null = null;
  private _executionMode: RuntimeExecutionMode;

  constructor(options: AgentSessionOptions) {
    this._project = options.project;
    this._modelSelector = options.modelSelector;
    this._reasoning = options.reasoning;
    this._executionMode = options.executionMode;
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
    this._toolPolicy = new ToolExecutionPolicy({
      tools: options.tools.map(tool => (tool.kind === "executable"
        ? {
          ...tool,
          execute: async (...args) => this._sessionState.executeTool(
            async () => tool.execute(...args)
          )
        }
        : tool)),
      activeToolNames: options.activeToolNames
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
      streamFn:
        options.streamFn
        ?? ((model, context, streamOptions) =>
          options.models.streamSimple(model, context, streamOptions)),
      prepareNextTurnWithContext: async ({ toolResults }) => {
        try {
          await this._sessionState.completeStep(toolResults, {
            deferred: toolResults.some(result =>
              this._toolPolicy.isDeferredToolResult(result))
          });
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
    await this.validateState();
    await this._resolveInstructions();
    await this._agent.prompt(message as AgentMessage | AgentMessage[]);
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
    await this.validateState();
    await this._resolveInstructions();
    await this._agent.continue();
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

  private async _resolveInstructions(): Promise<void> {
    this._instructionSnapshot = await this._instructions.resolve(
      this._executionMode !== "manual"
    );
    this._agent.state.systemPrompt = this._instructionSnapshot.markdown;
  }
}
