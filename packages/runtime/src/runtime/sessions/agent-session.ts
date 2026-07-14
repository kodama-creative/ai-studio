import {
  Agent,
  type AgentMessage,
  type StreamFn,
  type ThinkingLevel,
} from "@earendil-works/pi-agent-core";
import type {
  Api,
  Model,
  Models,
  ToolResultMessage,
} from "@earendil-works/pi-ai";

import {
  AgentEventProjector,
  type AgentSessionEvent,
  type AgentSessionPersistence,
} from "../../execution/agent-event-projector";
import { ToolExecutionPolicy } from "../../execution/tool-execution-policy";
import type { AgentModelSelector } from "../../shared/agent-definition";
import type { RuntimeExecutionMode } from "../../shared/runtime-execution";
import type { AgentProjectSnapshot } from "../agent/agent-project";
import type { PreparedAgentTool } from "../agent/prepared-tool";

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
  private readonly _persistence?: AgentSessionPersistence;
  private _executionMode: RuntimeExecutionMode;

  constructor(options: AgentSessionOptions) {
    this._project = options.project;
    this._modelSelector = options.modelSelector;
    this._reasoning = options.reasoning;
    this._executionMode = options.executionMode;
    this._persistence = options.persistence;
    this._toolPolicy = new ToolExecutionPolicy({
      tools: options.tools,
      activeToolNames: options.activeToolNames,
    });
    this._agent = new Agent({
      sessionId: options.id,
      initialState: {
        systemPrompt:
          options.systemPrompt ??
          _systemPrompt(options.project, options.instructionsPrefix),
        model: options.model,
        thinkingLevel: options.reasoning ?? "off",
        messages: this._toolPolicy.restoreDeferredPlaceholders(
          options.initialMessages,
          options.executionMode
        ),
        tools: this._toolPolicy.toolsForMode(options.executionMode),
      },
      streamFn:
        options.streamFn ??
        ((model, context, streamOptions) =>
          options.models.streamSimple(model, context, streamOptions)),
    });
    this._eventProjector = new AgentEventProjector(
      () => this._executionMode,
      this._toolPolicy,
      () => this.messages,
      options.persistence
    );
    this._agent.subscribe((event) => this._eventProjector.handle(event));
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

  setExecutionMode(mode: RuntimeExecutionMode): void {
    if (this._agent.state.isStreaming) {
      throw new Error(
        "Cannot change execution mode while the session is running"
      );
    }
    this._executionMode = mode;
    this._agent.state.tools = this._toolPolicy.toolsForMode(mode);
  }

  prompt(message: AgentMessage | AgentMessage[] | string): Promise<void> {
    return this._agent.prompt(message as AgentMessage | AgentMessage[]);
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
    await this._persistence?.replaceMessages(this.messages);
  }

  continue(): Promise<void> {
    return this._agent.continue();
  }

  abort(): void {
    this._agent.abort();
  }

  waitForIdle(): Promise<void> {
    return this._agent.waitForIdle();
  }

  subscribe(
    listener: (event: AgentSessionEvent) => Promise<void> | void
  ): () => void {
    return this._eventProjector.subscribe(listener);
  }
}

function _systemPrompt(
  project: AgentProjectSnapshot,
  instructionsPrefix: string
): string {
  return [instructionsPrefix.trim(), project.instructions.trim()]
    .filter(Boolean)
    .join("\n\n");
}
