import type { SandboxSession } from "@llm-space/agent/sandbox";
import type {
  ToolContext,
  ToolDefinition,
  ToolModelOutput,
} from "@llm-space/agent/tools";

import type { ModelTurnEngine } from "../execution/model-engine";
import { validateSchemaValue } from "../execution/schema-validation";
import type {
  AgentGeneration,
  PreparedAgentDefinition,
  PreparedTool,
} from "../generation/generation";
import { resolveAgentGeneration } from "../generation/generation";
import type {
  HarnessAssistantMessage,
  HarnessEvent,
  HarnessEventData,
  HarnessPrincipal,
  HarnessSessionSnapshot,
  HarnessToolCall,
  HarnessToolMessage,
  SessionCommand,
  SessionCommandReceipt,
  SessionCommandSource,
  SessionEventCursor,
} from "../session/protocol";
import type {
  NewSessionCommand,
  SessionCommandLease,
} from "../session/session-command-queue";
import {
  InMemorySessionCommandQueue,
  InMemorySessionEventLog,
  InMemorySessionRepository,
  type SessionCommandQueue,
  type SessionEventLog,
  type SessionRepository,
} from "../storage";

import {
  DEFAULT_HARNESS_SCHEDULER,
  type HarnessScheduler,
} from "./harness-scheduler";

const DEFAULT_MAX_STEPS_PER_TURN = 32;
const DEFAULT_COMMAND_LEASE_DURATION_MS = 30_000;

export interface CreateHarnessOptions {
  readonly engine: ModelTurnEngine;
  readonly repository?: SessionRepository;
  readonly eventLog?: SessionEventLog;
  readonly commandQueue?: SessionCommandQueue;
  readonly clock?: () => number;
  readonly scheduler?: HarnessScheduler;
  readonly generateId?: (prefix: string) => string;
  readonly maxStepsPerTurn?: number;
  readonly commandLeaseDurationMs?: number;
  readonly getSandbox?: (input: {
    readonly sessionId: string;
  }) => Promise<SandboxSession>;
}

export interface CreateSessionInput {
  readonly id?: string;
  readonly mode?: "conversation" | "task";
  readonly state?: Readonly<Record<string, unknown>>;
  readonly initiator?: HarnessPrincipal | null;
}

export interface SessionInput {
  readonly message: string;
  readonly principal?: HarnessPrincipal | null;
  readonly source?: SessionCommandSource;
}

export interface AgentSession {
  readonly id: string;
  submit(input: SessionInput): Promise<SessionCommandReceipt>;
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
  readonly commandQueue: SessionCommandQueue;
  readonly clock: () => number;
  readonly scheduler: HarnessScheduler;
  readonly generateId: (prefix: string) => string;
  readonly maxStepsPerTurn: number;
  readonly commandLeaseDurationMs: number;
  readonly getSandbox: (input: {
    readonly sessionId: string;
  }) => Promise<SandboxSession>;
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
    const now = this._deps.clock();
    const snapshot: HarnessSessionSnapshot = {
      id,
      agentId: definition.agentId,
      generationId: definition.generationId,
      mode: input.mode ?? "conversation",
      status: "waiting",
      messages: [],
      state: structuredClone(input.state ?? {}),
      auth: { initiator: structuredClone(input.initiator ?? null) },
      turnSequence: 0,
      eventSequence: 0,
      createdAt: now,
      updatedAt: now,
    };
    if ((await this._deps.repository.create(snapshot)) === "existing") {
      throw new Error(`Session "${id}" already exists.`);
    }
    const session = new AgentSessionImpl(this._deps, definition, snapshot);
    this._sessions.set(id, session);
    await session.initialize();
    await session.resume();
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
    await session.resume();
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
  private _activeCommand: SessionCommand | undefined;
  private _activeLease: SessionCommandLease | undefined;
  private _worker: Promise<void> | undefined;
  private _drainRequested = false;
  private _observedActiveLease = false;
  private _leaseRecoveryTimer:
    ReturnType<HarnessScheduler["setTimeout"]> | undefined;

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

  async resume(): Promise<void> {
    await this._reloadSnapshot();
    const now = this._deps.clock();
    const recovery = await this._deps.commandQueue.recover(this.id, {
      now,
      leaseExpiresAt: now + this._deps.commandLeaseDurationMs,
    });
    for (const lease of recovery.recovered) {
      try {
        if (this._snapshot.lastCommand?.commandId === lease.command.id) {
          await this._withActiveLease(lease, () =>
            this._ensureTerminalEvent(this._snapshot.lastCommand!)
          );
          await lease.complete();
        } else if (
          this._snapshot.status === "running" &&
          (lease.command.id === this._snapshot.activeCommandId ||
            lease.command.turnId === this._snapshot.activeTurnId)
        ) {
          await this._withActiveLease(lease, () =>
            this._recoverInterruptedTurn(lease.command.id)
          );
          await lease.complete();
        } else {
          await lease.release();
        }
      } catch (error) {
        await lease.release();
        throw error;
      }
    }
    const nextLeaseExpiration = recovery.active.reduce(
      (earliest, lease) => Math.min(earliest, lease.leaseExpiresAt),
      Number.POSITIVE_INFINITY
    );
    if (Number.isFinite(nextLeaseExpiration)) {
      this._scheduleLeaseRecovery(nextLeaseExpiration);
    } else {
      this._clearLeaseRecovery();
    }
    if (this._snapshot.status === "running") {
      const active = recovery.active.some(
        (lease) =>
          lease.command.id === this._snapshot.activeCommandId ||
          lease.command.turnId === this._snapshot.activeTurnId
      );
      if (active) {
        this._observedActiveLease = true;
        return;
      }
      this._observedActiveLease = false;
      await this._recoverInterruptedTurn();
    }
    this._scheduleDrain();
  }

  private _scheduleLeaseRecovery(leaseExpiresAt: number): void {
    this._clearLeaseRecovery();
    const delay = Math.max(1, leaseExpiresAt - this._deps.clock());
    this._leaseRecoveryTimer = this._deps.scheduler.setTimeout(() => {
      this._leaseRecoveryTimer = undefined;
      void this.resume().catch(() => {
        this._scheduleLeaseRecovery(
          this._deps.clock() + this._deps.commandLeaseDurationMs
        );
      });
    }, delay);
    this._leaseRecoveryTimer.unref?.();
  }

  private _clearLeaseRecovery(): void {
    if (this._leaseRecoveryTimer === undefined) return;
    this._deps.scheduler.clearTimeout(this._leaseRecoveryTimer);
    this._leaseRecoveryTimer = undefined;
  }

  async submit(input: SessionInput): Promise<SessionCommandReceipt> {
    if (this._abortController === undefined) await this._reloadSnapshot();
    if (input.message.trim().length === 0) {
      throw new Error("Session input message must not be empty.");
    }
    if (
      this._snapshot.status === "completed" ||
      this._snapshot.status === "failed"
    ) {
      throw new Error(
        `Session "${this.id}" cannot accept input while ${this._snapshot.status}.`
      );
    }
    _validateCommandSource(input.source);

    const acceptedAt = this._deps.clock();
    const stableIds = await _stableDeliveryIds(this.id, input.source);
    const proposedCommand: NewSessionCommand = {
      id: stableIds?.commandId ?? this._deps.generateId("command"),
      sessionId: this.id,
      turnId: stableIds?.turnId ?? this._deps.generateId("turn"),
      message: input.message,
      principal: input.principal ?? null,
      ...(input.source === undefined ? {} : { source: input.source }),
      createdAt: acceptedAt,
    };
    const result = await this._deps.commandQueue.enqueue(proposedCommand);
    const command = result.command;
    if (result.status === "duplicate") {
      _assertIdempotentReplay(proposedCommand, command);
    }
    const receipt: SessionCommandReceipt = {
      sessionId: this.id,
      commandId: command.id,
      turnId: command.turnId,
      acceptedAt: command.createdAt,
      deduplicated: result.status === "duplicate",
      afterSequence:
        result.status === "duplicate" ? 0 : this._snapshot.eventSequence,
    };
    this._scheduleDrain();
    return receipt;
  }

  async send(input: SessionInput): Promise<void> {
    const receipt = await this.submit(input);
    for await (const event of this.events({
      afterSequence: receipt.afterSequence,
      follow: true,
    })) {
      if (
        event.event.type === "turn.failed" &&
        event.event.turnId === receipt.turnId
      ) {
        throw new Error(event.event.message);
      }
      if (
        (event.event.type === "turn.completed" ||
          event.event.type === "turn.cancelled") &&
        event.event.turnId === receipt.turnId
      ) {
        return;
      }
    }
    throw new Error(
      `Session turn "${receipt.turnId}" ended without a terminal event.`
    );
  }

  private async _executeCommand(command: SessionCommand): Promise<void> {
    if (
      this._abortController !== undefined ||
      this._snapshot.status === "running"
    ) {
      throw new Error(`Session "${this.id}" is already running.`);
    }

    const abortController = new AbortController();
    this._abortController = abortController;
    this._activeCommand = command;
    const turnSequence = this._snapshot.turnSequence + 1;
    const turnId = command.turnId;
    const userMessage = {
      id: this._deps.generateId("message"),
      role: "user" as const,
      content: command.message,
    };
    this._snapshot = {
      ...this._snapshot,
      activeTurnId: turnId,
      activeCommandId: command.id,
      status: "running",
      turnSequence,
      messages: [...this._snapshot.messages, userMessage],
      updatedAt: this._deps.clock(),
      error: undefined,
    };
    await this._save();
    await this._emit({
      type: "turn.started",
      commandId: command.id,
      turnId,
      turnSequence,
    });
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
        activeCommandId: undefined,
        status: this._snapshot.mode === "task" ? "completed" : "waiting",
        lastCommand: {
          commandId: command.id,
          turnId,
          status: "completed",
        },
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
          activeCommandId: undefined,
          status: "waiting",
          lastCommand: {
            commandId: command.id,
            turnId,
            status: "cancelled",
          },
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
        activeCommandId: undefined,
        status: "failed",
        lastCommand: {
          commandId: command.id,
          turnId,
          status: "failed",
        },
        updatedAt: this._deps.clock(),
        error: message,
      };
      await this._save();
      await this._emit({ type: "turn.failed", turnId, message });
      await this._emit({ type: "session.failed", message });
      return;
    } finally {
      this._abortController = undefined;
      this._activeCommand = undefined;
    }
  }

  private _scheduleDrain(): void {
    this._drainRequested = true;
    if (this._worker !== undefined) return;
    this._worker = Promise.resolve()
      .then(() => this._consumeCommands())
      .finally(() => {
        this._worker = undefined;
        if (this._drainRequested) this._scheduleDrain();
      });
  }

  private async _consumeCommands(): Promise<void> {
    while (this._drainRequested) {
      this._drainRequested = false;
      while (true) {
        const now = this._deps.clock();
        const lease = await this._deps.commandQueue.claim(this.id, {
          now,
          leaseExpiresAt: now + this._deps.commandLeaseDurationMs,
        });
        if (lease === undefined) break;
        try {
          await this._executeLeasedCommand(lease);
          await lease.complete();
        } catch {
          // Storage or event-log failures are not terminal turn outcomes. Keep
          // the command pending so a later worker can recover it.
          await lease.release();
          return;
        }
        if (
          this._snapshot.status === "completed" ||
          this._snapshot.status === "failed" ||
          this._snapshot.status === "running"
        ) {
          return;
        }
      }
    }
  }

  private async _executeLeasedCommand(
    lease: SessionCommandLease
  ): Promise<void> {
    await this._reloadSnapshot();
    if (this._snapshot.lastCommand?.commandId === lease.command.id) {
      await this._withActiveLease(lease, () =>
        this._ensureTerminalEvent(this._snapshot.lastCommand!)
      );
      return;
    }
    await this._withActiveLease(lease, () =>
      this._executeCommand(lease.command)
    );
  }

  private async _withActiveLease<T>(
    lease: SessionCommandLease,
    operation: () => Promise<T>
  ): Promise<T> {
    const renewEvery = Math.max(
      1,
      Math.floor(this._deps.commandLeaseDurationMs / 3)
    );
    this._activeLease = lease;
    const timer = this._deps.scheduler.setInterval(() => {
      void lease
        .renew(this._deps.clock() + this._deps.commandLeaseDurationMs)
        .catch((error: unknown) => this._abortController?.abort(error));
    }, renewEvery);
    try {
      return await operation();
    } finally {
      this._deps.scheduler.clearInterval(timer);
      this._activeLease = undefined;
    }
  }

  async cancel(): Promise<void> {
    if (this._abortController !== undefined) {
      this._abortController.abort();
      return;
    }
    if (this._snapshot.status !== "running") return;
    if (this._observedActiveLease) {
      throw new Error(
        `Session "${this.id}" is running in another Harness worker.`
      );
    }
    const turnId = this._snapshot.activeTurnId;
    if (turnId === undefined) {
      throw new Error(
        `Running session "${this.id}" is missing its active turn identity.`
      );
    }
    const commandId = this._snapshot.activeCommandId;
    this._snapshot = {
      ...this._snapshot,
      activeTurnId: undefined,
      activeCommandId: undefined,
      status: "waiting",
      ...(commandId === undefined
        ? {}
        : {
            lastCommand: {
              commandId,
              turnId,
              status: "cancelled" as const,
            },
          }),
      updatedAt: this._deps.clock(),
    };
    await this._save();
    await this._emit({ type: "turn.cancelled", turnId });
    await this._emit({ type: "session.waiting" });
    this._scheduleDrain();
  }

  private async _recoverInterruptedTurn(
    recoveredCommandId?: string
  ): Promise<void> {
    const turnId = this._snapshot.activeTurnId;
    if (turnId === undefined) {
      throw new Error(
        `Running session "${this.id}" is missing its active turn identity.`
      );
    }
    const commandId = this._snapshot.activeCommandId ?? recoveredCommandId;
    const terminal = await this._findTerminalTurnEvent(turnId);
    if (terminal !== undefined) {
      const status =
        terminal.event.type === "turn.completed"
          ? this._snapshot.mode === "task"
            ? "completed"
            : "waiting"
          : terminal.event.type === "turn.failed"
            ? "failed"
            : "waiting";
      this._snapshot = {
        ...this._snapshot,
        activeTurnId: undefined,
        activeCommandId: undefined,
        status,
        eventSequence: Math.max(
          this._snapshot.eventSequence,
          terminal.maxSequence
        ),
        ...(commandId === undefined
          ? {}
          : {
              lastCommand: {
                commandId,
                turnId,
                status:
                  terminal.event.type === "turn.completed"
                    ? ("completed" as const)
                    : terminal.event.type === "turn.failed"
                      ? ("failed" as const)
                      : ("cancelled" as const),
              },
            }),
        ...(terminal.event.type === "turn.failed"
          ? { error: terminal.event.message }
          : { error: undefined }),
        updatedAt: this._deps.clock(),
      };
      await this._save();
      await this._emit(
        status === "completed"
          ? { type: "session.completed" }
          : status === "failed"
            ? { type: "session.failed", message: this._snapshot.error ?? "" }
            : { type: "session.waiting" }
      );
      return;
    }
    this._snapshot = {
      ...this._snapshot,
      activeTurnId: undefined,
      activeCommandId: undefined,
      status: "waiting",
      ...(commandId === undefined
        ? {}
        : {
            lastCommand: {
              commandId,
              turnId,
              status: "cancelled" as const,
            },
          }),
      updatedAt: this._deps.clock(),
    };
    await this._save();
    await this._emit({ type: "turn.cancelled", turnId });
    await this._emit({ type: "session.waiting" });
  }

  private async _findTerminalTurnEvent(turnId: string): Promise<
    | {
        readonly event: Extract<
          HarnessEventData,
          { readonly type: "turn.completed" | "turn.cancelled" | "turn.failed" }
        >;
        readonly maxSequence: number;
      }
    | undefined
  > {
    let terminal:
      | Extract<
          HarnessEventData,
          { readonly type: "turn.completed" | "turn.cancelled" | "turn.failed" }
        >
      | undefined;
    let maxSequence = this._snapshot.eventSequence;
    for await (const item of this._deps.eventLog.read(this.id)) {
      maxSequence = Math.max(maxSequence, item.sequence);
      if (
        (item.event.type === "turn.completed" ||
          item.event.type === "turn.cancelled" ||
          item.event.type === "turn.failed") &&
        item.event.turnId === turnId
      ) {
        terminal = item.event;
      }
    }
    return terminal === undefined
      ? undefined
      : { event: terminal, maxSequence };
  }

  private async _ensureTerminalEvent(
    terminal: NonNullable<HarnessSessionSnapshot["lastCommand"]>
  ): Promise<void> {
    const boundaryType =
      terminal.status === "failed"
        ? "session.failed"
        : this._snapshot.status === "completed"
          ? "session.completed"
          : "session.waiting";
    let turnSequence: number | undefined;
    let boundarySequence: number | undefined;
    let maxSequence = this._snapshot.eventSequence;
    for await (const item of this._deps.eventLog.read(this.id)) {
      maxSequence = Math.max(maxSequence, item.sequence);
      if (
        (item.event.type === "turn.completed" ||
          item.event.type === "turn.cancelled" ||
          item.event.type === "turn.failed") &&
        item.event.turnId === terminal.turnId
      ) {
        turnSequence = Math.max(turnSequence ?? 0, item.sequence);
      }
      if (item.event.type === boundaryType) {
        boundarySequence = Math.max(boundarySequence ?? 0, item.sequence);
      }
    }
    this._snapshot = {
      ...this._snapshot,
      eventSequence: maxSequence,
    };
    if (turnSequence === undefined) {
      if (terminal.status === "completed") {
        await this._emit({ type: "turn.completed", turnId: terminal.turnId });
      } else if (terminal.status === "cancelled") {
        await this._emit({ type: "turn.cancelled", turnId: terminal.turnId });
      } else {
        await this._emit({
          type: "turn.failed",
          turnId: terminal.turnId,
          message: this._snapshot.error ?? "Session command failed.",
        });
      }
      turnSequence = this._snapshot.eventSequence;
    }
    if (boundarySequence !== undefined && boundarySequence > turnSequence) {
      return;
    }
    await this._emit(
      boundaryType === "session.failed"
        ? {
            type: "session.failed",
            message: this._snapshot.error ?? "Session command failed.",
          }
        : { type: boundaryType }
    );
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
    const getSandbox = this._deps.getSandbox;
    return {
      abortSignal: signal,
      callId: call.id,
      toolName: call.name,
      session: {
        id: this.id,
        auth: {
          current: this._activeCommand?.principal ?? null,
          initiator: this._snapshot.auth?.initiator ?? null,
        },
        turn: { id: turnId, sequence: this._snapshot.turnSequence },
      },
      getSandbox() {
        return getSandbox({ sessionId: this.session.id });
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
    await this._renewActiveLease();
    await this._deps.eventLog.append({
      sessionId: this.id,
      sequence,
      timestamp,
      event,
    });
  }

  private async _save(): Promise<void> {
    await this._renewActiveLease();
    await this._deps.repository.save(this._snapshot);
  }

  private async _renewActiveLease(): Promise<void> {
    if (this._activeLease === undefined) return;
    await this._activeLease.renew(
      this._deps.clock() + this._deps.commandLeaseDurationMs
    );
  }

  private async _reloadSnapshot(): Promise<void> {
    const snapshot = await this._deps.repository.load(this.id);
    if (snapshot === undefined) {
      throw new Error(`Session "${this.id}" no longer exists.`);
    }
    _assertSessionOwner(snapshot, this._agent);
    this._snapshot = structuredClone(snapshot);
  }
}

export function createHarness(options: CreateHarnessOptions): Harness {
  const maxStepsPerTurn = options.maxStepsPerTurn ?? DEFAULT_MAX_STEPS_PER_TURN;
  if (!Number.isInteger(maxStepsPerTurn) || maxStepsPerTurn <= 0) {
    throw new Error("maxStepsPerTurn must be a positive integer.");
  }
  const commandLeaseDurationMs =
    options.commandLeaseDurationMs ?? DEFAULT_COMMAND_LEASE_DURATION_MS;
  if (
    !Number.isInteger(commandLeaseDurationMs) ||
    commandLeaseDurationMs <= 0
  ) {
    throw new Error("commandLeaseDurationMs must be a positive integer.");
  }
  return new HarnessImpl({
    engine: options.engine,
    repository: options.repository ?? new InMemorySessionRepository(),
    eventLog: options.eventLog ?? new InMemorySessionEventLog(),
    commandQueue: options.commandQueue ?? new InMemorySessionCommandQueue(),
    clock: options.clock ?? Date.now,
    scheduler: options.scheduler ?? DEFAULT_HARNESS_SCHEDULER,
    generateId:
      options.generateId ??
      ((prefix) => `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`),
    maxStepsPerTurn,
    commandLeaseDurationMs,
    getSandbox:
      options.getSandbox ??
      (() =>
        Promise.reject(
          new Error("This harness host does not provide a sandbox.")
        )),
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

function _validateCommandSource(
  source: SessionCommandSource | undefined
): void {
  if (source === undefined) return;
  if (source.channelId.trim().length === 0) {
    throw new Error("Session command channelId must not be empty.");
  }
  if (source.address.trim().length === 0) {
    throw new Error("Session command address must not be empty.");
  }
  if (source.deliveryId?.trim().length === 0) {
    throw new Error("Session command deliveryId must not be empty.");
  }
}

async function _stableDeliveryIds(
  sessionId: string,
  source: SessionCommandSource | undefined
): Promise<
  { readonly commandId: string; readonly turnId: string } | undefined
> {
  if (source?.deliveryId === undefined) return undefined;
  const identity = JSON.stringify([
    sessionId,
    source.channelId,
    source.address,
    source.deliveryId,
  ]);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(identity)
  );
  const value = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
  return {
    commandId: `command_${value}`,
    turnId: `turn_${value}`,
  };
}

function _assertIdempotentReplay(
  proposed: NewSessionCommand,
  existing: SessionCommand
): void {
  const proposedPayload = {
    sessionId: proposed.sessionId,
    turnId: proposed.turnId,
    message: proposed.message,
    principal: proposed.principal,
    source: proposed.source,
  };
  const existingPayload = {
    sessionId: existing.sessionId,
    turnId: existing.turnId,
    message: existing.message,
    principal: existing.principal,
    source: existing.source,
  };
  if (_canonicalJson(proposedPayload) !== _canonicalJson(existingPayload)) {
    throw new Error(
      `Session command "${existing.id}" reuses a delivery identity with a different payload.`
    );
  }
}

function _canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(_canonicalJson).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${_canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
