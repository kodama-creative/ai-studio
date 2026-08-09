import type { ToolContext, ToolDefinition } from "@llm-space/agent/tools";
import type { ToolModelOutput } from "@llm-space/agent/tools";

import {
  type AgentGeneration,
  type PreparedAgentDefinition,
  type PreparedTool,
  resolveAgentGeneration,
} from "./generation";
import type { ModelTurnEngine } from "./model-engine";
import type {
  HarnessAssistantMessage,
  HarnessEvent,
  HarnessEventData,
  HarnessSessionSnapshot,
  HarnessToolCall,
  HarnessToolMessage,
  SessionEventCursor,
} from "./protocol";
import { validateSchemaValue } from "./schema-validation";
import {
  InMemorySessionEventLog,
  InMemorySessionRepository,
  type SessionEventLog,
  type SessionRepository,
} from "./storage";

const DEFAULT_MAX_STEPS_PER_TURN = 32;

export interface CreateHarnessOptions {
  readonly engine: ModelTurnEngine;
  readonly repository?: SessionRepository;
  readonly eventLog?: SessionEventLog;
  readonly clock?: () => number;
  readonly generateId?: (prefix: string) => string;
  readonly maxStepsPerTurn?: number;
}

export interface CreateSessionInput {
  readonly id?: string;
  readonly mode?: "conversation" | "task";
  readonly state?: Readonly<Record<string, unknown>>;
}

export interface SessionInput {
  readonly message: string;
}

export interface AgentSession {
  readonly id: string;
  send(input: SessionInput): Promise<void>;
  cancel(): Promise<void>;
  snapshot(): Promise<HarnessSessionSnapshot>;
  events(cursor?: SessionEventCursor): AsyncIterable<HarnessEvent>;
}

export interface PreparedAgent {
  readonly agentId: string;
  readonly generationId: string;
  createSession(input?: CreateSessionInput): Promise<AgentSession>;
  attachSession(sessionId: string): Promise<AgentSession | undefined>;
}

export interface Harness {
  prepare(generation: AgentGeneration): Promise<PreparedAgent>;
}

interface HarnessDependencies {
  readonly engine: ModelTurnEngine;
  readonly repository: SessionRepository;
  readonly eventLog: SessionEventLog;
  readonly clock: () => number;
  readonly generateId: (prefix: string) => string;
  readonly maxStepsPerTurn: number;
}

class HarnessImpl implements Harness {
  private readonly _agents = new Map<string, PreparedAgentImpl>();
  private readonly _sessions = new Map<string, AgentSessionImpl>();

  constructor(private readonly _deps: HarnessDependencies) {}

  async prepare(generation: AgentGeneration): Promise<PreparedAgent> {
    const definition = await resolveAgentGeneration(generation);
    const key = _agentKey(definition.agentId, definition.generationId);
    const existing = this._agents.get(key);
    if (existing !== undefined) return existing;
    const prepared = new PreparedAgentImpl(this, definition);
    this._agents.set(key, prepared);
    return prepared;
  }

  async createSession(
    definition: PreparedAgentDefinition,
    input: CreateSessionInput
  ): Promise<AgentSession> {
    const id = input.id ?? this._deps.generateId("session");
    if ((await this._deps.repository.load(id)) !== undefined) {
      throw new Error(`Session "${id}" already exists.`);
    }
    const now = this._deps.clock();
    const snapshot: HarnessSessionSnapshot = {
      id,
      agentId: definition.agentId,
      generationId: definition.generationId,
      mode: input.mode ?? "conversation",
      status: "waiting",
      messages: [],
      state: structuredClone(input.state ?? {}),
      turnSequence: 0,
      eventSequence: 0,
      createdAt: now,
      updatedAt: now,
    };
    await this._deps.repository.save(snapshot);
    const session = new AgentSessionImpl(this._deps, definition, snapshot);
    this._sessions.set(id, session);
    await session.initialize();
    return session;
  }

  async attachSession(
    definition: PreparedAgentDefinition,
    sessionId: string
  ): Promise<AgentSession | undefined> {
    const active = this._sessions.get(sessionId);
    if (active !== undefined) {
      const snapshot = await active.snapshot();
      _assertSessionOwner(snapshot, definition);
      return active;
    }
    const snapshot = await this._deps.repository.load(sessionId);
    if (snapshot === undefined) return undefined;
    _assertSessionOwner(snapshot, definition);
    const session = new AgentSessionImpl(this._deps, definition, snapshot);
    this._sessions.set(sessionId, session);
    return session;
  }
}

class PreparedAgentImpl implements PreparedAgent {
  readonly agentId: string;
  readonly generationId: string;

  constructor(
    private readonly _harness: HarnessImpl,
    private readonly _definition: PreparedAgentDefinition
  ) {
    this.agentId = _definition.agentId;
    this.generationId = _definition.generationId;
  }

  createSession(input: CreateSessionInput = {}): Promise<AgentSession> {
    return this._harness.createSession(this._definition, input);
  }

  attachSession(sessionId: string): Promise<AgentSession | undefined> {
    return this._harness.attachSession(this._definition, sessionId);
  }
}

class AgentSessionImpl implements AgentSession {
  readonly id: string;
  private _snapshot: HarnessSessionSnapshot;
  private _abortController: AbortController | undefined;

  constructor(
    private readonly _deps: HarnessDependencies,
    private readonly _agent: PreparedAgentDefinition,
    snapshot: HarnessSessionSnapshot
  ) {
    this.id = snapshot.id;
    this._snapshot = structuredClone(snapshot);
  }

  async initialize(): Promise<void> {
    await this._emit({
      type: "session.started",
      agentId: this._agent.agentId,
      generationId: this._agent.generationId,
    });
  }

  async send(input: SessionInput): Promise<void> {
    if (input.message.trim().length === 0) {
      throw new Error("Session input message must not be empty.");
    }
    if (
      this._abortController !== undefined ||
      this._snapshot.status === "running"
    ) {
      throw new Error(`Session "${this.id}" is already running.`);
    }
    if (
      this._snapshot.status === "completed" ||
      this._snapshot.status === "failed"
    ) {
      throw new Error(
        `Session "${this.id}" cannot accept input while ${this._snapshot.status}.`
      );
    }

    const abortController = new AbortController();
    this._abortController = abortController;
    const turnSequence = this._snapshot.turnSequence + 1;
    const turnId = this._deps.generateId("turn");
    const userMessage = {
      id: this._deps.generateId("message"),
      role: "user" as const,
      content: input.message,
    };
    this._snapshot = {
      ...this._snapshot,
      activeTurnId: turnId,
      status: "running",
      turnSequence,
      messages: [...this._snapshot.messages, userMessage],
      updatedAt: this._deps.clock(),
      error: undefined,
    };
    await this._save();
    await this._emit({ type: "turn.started", turnId, turnSequence });
    await this._emit({
      type: "message.received",
      turnId,
      message: userMessage,
    });

    try {
      await this._runTurn(turnId, abortController.signal);
      await this._emit({ type: "turn.completed", turnId });
      this._snapshot = {
        ...this._snapshot,
        activeTurnId: undefined,
        status: this._snapshot.mode === "task" ? "completed" : "waiting",
        updatedAt: this._deps.clock(),
      };
      await this._save();
      await this._emit(
        this._snapshot.status === "completed"
          ? { type: "session.completed" }
          : { type: "session.waiting" }
      );
    } catch (error) {
      if (abortController.signal.aborted) {
        this._snapshot = {
          ...this._snapshot,
          activeTurnId: undefined,
          status: "waiting",
          updatedAt: this._deps.clock(),
        };
        await this._save();
        await this._emit({ type: "turn.cancelled", turnId });
        await this._emit({ type: "session.waiting" });
        return;
      }
      const message = _errorMessage(error);
      this._snapshot = {
        ...this._snapshot,
        activeTurnId: undefined,
        status: "failed",
        updatedAt: this._deps.clock(),
        error: message,
      };
      await this._save();
      await this._emit({ type: "turn.failed", turnId, message });
      await this._emit({ type: "session.failed", message });
      throw error;
    } finally {
      this._abortController = undefined;
    }
  }

  async cancel(): Promise<void> {
    if (this._abortController !== undefined) {
      this._abortController.abort();
      return;
    }
    if (this._snapshot.status !== "running") return;
    const turnId = this._snapshot.activeTurnId;
    if (turnId === undefined) {
      throw new Error(
        `Running session "${this.id}" is missing its active turn identity.`
      );
    }
    this._snapshot = {
      ...this._snapshot,
      activeTurnId: undefined,
      status: "waiting",
      updatedAt: this._deps.clock(),
    };
    await this._save();
    await this._emit({ type: "turn.cancelled", turnId });
    await this._emit({ type: "session.waiting" });
  }

  snapshot(): Promise<HarnessSessionSnapshot> {
    return Promise.resolve(structuredClone(this._snapshot));
  }

  events(cursor?: SessionEventCursor): AsyncIterable<HarnessEvent> {
    return this._deps.eventLog.read(this.id, cursor);
  }

  private async _runTurn(turnId: string, signal: AbortSignal): Promise<void> {
    for (
      let stepIndex = 0;
      stepIndex < this._deps.maxStepsPerTurn;
      stepIndex++
    ) {
      try {
        _throwIfAborted(signal);
        await this._emit({ type: "step.started", turnId, stepIndex });
        const messageId = this._deps.generateId("message");
        let content = "";
        const toolCalls: HarnessToolCall[] = [];
        let finishReason:
          "stop" | "tool-calls" | "length" | "other" | undefined;

        for await (const event of this._deps.engine.run(
          {
            agentId: this._agent.agentId,
            instructions: this._agent.instructions,
            messages: this._snapshot.messages,
            model: this._agent.model,
            tools: [...this._agent.tools.values()].map((tool) => tool.model),
          },
          { signal }
        )) {
          _throwIfAborted(signal);
          if (finishReason !== undefined) {
            throw new Error("Model turn emitted data after its finish event.");
          }
          if (event.type === "text.delta") {
            content += event.delta;
            await this._emit({
              type: "message.appended",
              turnId,
              messageId,
              delta: event.delta,
            });
          } else if (event.type === "tool.call") {
            toolCalls.push(event.call);
          } else {
            finishReason = event.reason;
          }
        }
        _assertModelTurnFinish(finishReason, toolCalls);
        if (content.length === 0 && toolCalls.length === 0) {
          throw new Error("Model turn completed without text or tool calls.");
        }
        const message: HarnessAssistantMessage = {
          id: messageId,
          role: "assistant",
          content,
          toolCalls,
        };
        this._snapshot = {
          ...this._snapshot,
          messages: [...this._snapshot.messages, message],
          updatedAt: this._deps.clock(),
        };
        await this._save();
        await this._emit({ type: "message.completed", turnId, message });

        if (toolCalls.length > 0) {
          await this._emit({
            type: "actions.requested",
            turnId,
            calls: toolCalls,
          });
          for (const call of toolCalls) {
            _throwIfAborted(signal);
            await this._executeTool(turnId, call, signal);
          }
        }
        await this._emit({ type: "step.completed", turnId, stepIndex });
        if (toolCalls.length === 0) return;
      } catch (error) {
        if (!signal.aborted) {
          await this._emit({
            type: "step.failed",
            turnId,
            stepIndex,
            message: _errorMessage(error),
          });
        }
        throw error;
      }
    }
    throw new Error(
      `Harness exceeded ${this._deps.maxStepsPerTurn} model steps in one turn.`
    );
  }

  private async _executeTool(
    turnId: string,
    call: HarnessToolCall,
    signal: AbortSignal
  ): Promise<void> {
    const prepared = this._agent.tools.get(call.name);
    let output: ToolModelOutput;
    let isError = false;
    if (prepared === undefined) {
      output = { type: "text", value: `Unknown tool: ${call.name}` };
      isError = true;
    } else {
      try {
        const result = await _executeToolDefinition(
          prepared,
          call,
          this._toolContext(turnId, call, signal)
        );
        output = result;
      } catch (error) {
        if (signal.aborted) throw error;
        output = { type: "text", value: _errorMessage(error) };
        isError = true;
      }
    }
    const message: HarnessToolMessage = {
      id: this._deps.generateId("message"),
      role: "tool",
      callId: call.id,
      name: call.name,
      output,
      isError,
    };
    this._snapshot = {
      ...this._snapshot,
      messages: [...this._snapshot.messages, message],
      updatedAt: this._deps.clock(),
    };
    await this._save();
    await this._emit({
      type: "action.result",
      turnId,
      callId: call.id,
      name: call.name,
      output,
      isError,
    });
  }

  private _toolContext(
    turnId: string,
    call: HarnessToolCall,
    signal: AbortSignal
  ): ToolContext {
    return {
      abortSignal: signal,
      callId: call.id,
      toolName: call.name,
      session: {
        id: this.id,
        auth: { current: null, initiator: null },
        turn: { id: turnId, sequence: this._snapshot.turnSequence },
      },
      getSandbox() {
        return Promise.reject(
          new Error("This harness host does not provide a sandbox.")
        );
      },
      getSkill(identifier: string) {
        throw new Error(
          `This harness host cannot resolve skill "${identifier}".`
        );
      },
      getToken() {
        return Promise.reject(
          new Error("This harness host does not provide connection tokens.")
        );
      },
      requireAuth() {
        throw new Error("This harness host cannot request authorization.");
      },
    };
  }

  private async _emit(event: HarnessEventData): Promise<void> {
    const sequence = this._snapshot.eventSequence + 1;
    const timestamp = this._deps.clock();
    this._snapshot = {
      ...this._snapshot,
      eventSequence: sequence,
      updatedAt: timestamp,
    };
    await this._save();
    await this._deps.eventLog.append({
      sessionId: this.id,
      sequence,
      timestamp,
      event,
    });
  }

  private _save(): Promise<void> {
    return this._deps.repository.save(this._snapshot);
  }
}

export function createHarness(options: CreateHarnessOptions): Harness {
  const maxStepsPerTurn = options.maxStepsPerTurn ?? DEFAULT_MAX_STEPS_PER_TURN;
  if (!Number.isInteger(maxStepsPerTurn) || maxStepsPerTurn <= 0) {
    throw new Error("maxStepsPerTurn must be a positive integer.");
  }
  return new HarnessImpl({
    engine: options.engine,
    repository: options.repository ?? new InMemorySessionRepository(),
    eventLog: options.eventLog ?? new InMemorySessionEventLog(),
    clock: options.clock ?? Date.now,
    generateId:
      options.generateId ??
      ((prefix) => `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`),
    maxStepsPerTurn,
  });
}

async function _executeToolDefinition(
  prepared: PreparedTool,
  call: HarnessToolCall,
  context: ToolContext
): Promise<ToolModelOutput> {
  const input = await validateSchemaValue(
    prepared.definition.inputSchema,
    call.input,
    { direction: "input", label: `Input for tool "${call.name}"` }
  );
  const execution = prepared.definition.execute(input, context);
  const values: unknown[] = [];
  if (_isAsyncIterable(execution)) {
    for await (const value of execution) {
      values.push(await _validateToolOutput(prepared.definition, call, value));
    }
  } else {
    values.push(
      await _validateToolOutput(prepared.definition, call, await execution)
    );
  }
  const value = values.length === 1 ? values[0] : values;
  if (prepared.definition.toModelOutput !== undefined) {
    return await prepared.definition.toModelOutput(value);
  }
  if (typeof value === "string") return { type: "text", value };
  return { type: "json", value: value ?? null };
}

async function _validateToolOutput(
  definition: ToolDefinition,
  call: HarnessToolCall,
  value: unknown
): Promise<unknown> {
  return definition.outputSchema === undefined
    ? value
    : await validateSchemaValue(definition.outputSchema, value, {
        direction: "output",
        label: `Output from tool "${call.name}"`,
      });
}

function _isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return (
    typeof value === "object" && value !== null && Symbol.asyncIterator in value
  );
}

function _assertSessionOwner(
  snapshot: HarnessSessionSnapshot,
  agent: PreparedAgentDefinition
): void {
  if (
    snapshot.agentId !== agent.agentId ||
    snapshot.generationId !== agent.generationId
  ) {
    throw new Error(
      `Session "${snapshot.id}" belongs to ${snapshot.agentId}@${snapshot.generationId}, not ${agent.agentId}@${agent.generationId}.`
    );
  }
}

function _throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason ?? new Error("Session turn aborted.");
}

function _assertModelTurnFinish(
  finishReason: "stop" | "tool-calls" | "length" | "other" | undefined,
  toolCalls: readonly HarnessToolCall[]
): void {
  if (finishReason === undefined) {
    throw new Error("Model turn ended without a finish event.");
  }
  if (finishReason === "length") {
    throw new Error("Model turn stopped because its output limit was reached.");
  }
  if (finishReason === "other") {
    throw new Error("Model turn ended with an unsupported finish reason.");
  }
  if (toolCalls.length > 0 && finishReason !== "tool-calls") {
    throw new Error(
      `Model turn emitted tool calls with finish reason "${finishReason}".`
    );
  }
  if (toolCalls.length === 0 && finishReason !== "stop") {
    throw new Error(
      `Model turn finished as "${finishReason}" without any tool calls.`
    );
  }
}

function _agentKey(agentId: string, generationId: string): string {
  return `${agentId}@${generationId}`;
}

function _errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
