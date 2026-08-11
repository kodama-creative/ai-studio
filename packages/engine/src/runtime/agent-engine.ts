import { createAgentStateContext } from "@llm-space/agent/context";
import type { ToolContext, ToolModelOutput } from "@llm-space/agent/tools";
import type {
  AssistantMessage,
  JsonValue,
  Message,
  ToolCall,
  ToolCallOutput,
} from "@llm-space/core";

import type {
  AgentResolver,
  AgentSnapshot,
  ExecutableAgent,
  Run,
  RunEvent,
  RunEventCursor,
  RunFrame,
  RunOutputSnapshot,
  Thread,
  ThreadCheckpoint,
  ThreadState,
} from "../domain";
import type { ModelTurnDriver, ModelTurnEvent } from "../execution";
import { validateSchemaValue } from "../execution/schema-validation";
import type { EngineStore, EngineStoreTransaction } from "../storage";

const DEFAULT_MAX_MODEL_TURNS = 32;
const DEFAULT_WORKER_LEASE_MS = 30_000;
const DELTA_FLUSH_INTERVAL_MS = 32;
const DELTA_FLUSH_SIZE = 4_096;
const DELTA_FLUSH_EVENT_COUNT = 16;

export interface CreateAgentEngineOptions {
  readonly store: EngineStore;
  readonly modelDriver: ModelTurnDriver;
  readonly agentResolver: AgentResolver;
  readonly createToolContext: (input: {
    readonly execution: ToolContext["execution"];
    readonly signal: AbortSignal;
  }) => ToolContext;
  readonly clock?: () => number;
  readonly generateId?: (prefix: string) => string;
  readonly workerId?: string;
  readonly workerLeaseMs?: number;
  readonly maxModelTurns?: number;
}

export interface CreateThreadInput {
  readonly initialState?: ThreadState;
}

export interface CommitThreadStateInput {
  readonly threadId: string;
  readonly expectedHeadCheckpointId: string;
  readonly threadState: ThreadState;
}

export interface ForkThreadInput {
  readonly threadId: string;
  readonly checkpointId?: string;
}

export interface StartRunInput {
  readonly threadId: string;
  readonly expectedHeadCheckpointId: string;
  readonly inputMessages: readonly Message[];
  readonly agentSnapshot: AgentSnapshot;
  readonly operationId?: string;
}

export interface RetryRunInput {
  readonly runId: string;
  readonly operationId?: string;
}

/**
 * Deep Engine interface used by Application and Studio modules.
 *
 * All state-changing commands are durable before they return. Run execution is
 * owned by the background Worker and is independent from stream subscribers.
 */
export interface AgentEngine {
  createThread(input?: CreateThreadInput): Promise<Thread>;
  getThread(threadId: string): Promise<Thread | undefined>;
  listThreads(): Promise<readonly Thread[]>;
  getCheckpoint(checkpointId: string): Promise<ThreadCheckpoint | undefined>;
  listCheckpoints(threadId: string): Promise<readonly ThreadCheckpoint[]>;
  commitThreadState(input: CommitThreadStateInput): Promise<ThreadCheckpoint>;
  forkThread(input: ForkThreadInput): Promise<Thread>;
  startRun(input: StartRunInput): Promise<Run>;
  retryRun(input: RetryRunInput): Promise<Run>;
  cancelRun(runId: string): Promise<void>;
  getRun(runId: string): Promise<Run | undefined>;
  getRunByOperationId(operationId: string): Promise<Run | undefined>;
  listRuns(threadId: string): Promise<readonly Run[]>;
  streamRun(runId: string, cursor?: RunEventCursor): AsyncIterable<RunFrame>;
  close(): Promise<void>;
}

export function createAgentEngine(
  options: CreateAgentEngineOptions
): AgentEngine {
  return new AgentEngineImpl(options);
}

class AgentEngineImpl implements AgentEngine {
  private readonly _clock: () => number;
  private readonly _generateId: (prefix: string) => string;
  private readonly _workerId: string;
  private readonly _workerLeaseMs: number;
  private readonly _maxModelTurns: number;
  private readonly _activeRuns = new Map<string, AbortController>();
  private readonly _waiters = new Set<() => void>();
  private _draining = false;
  private _closed = false;
  private _closePromise: Promise<void> | undefined;
  private readonly _maintenanceTimer: ReturnType<typeof setInterval>;

  constructor(private readonly _options: CreateAgentEngineOptions) {
    this._clock = _options.clock ?? Date.now;
    this._generateId =
      _options.generateId ??
      ((prefix) => `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`);
    this._workerId = _options.workerId ?? this._generateId("worker");
    this._workerLeaseMs = _options.workerLeaseMs ?? DEFAULT_WORKER_LEASE_MS;
    this._maxModelTurns = _options.maxModelTurns ?? DEFAULT_MAX_MODEL_TURNS;
    if (!Number.isInteger(this._maxModelTurns) || this._maxModelTurns <= 0) {
      throw new Error("maxModelTurns must be a positive integer.");
    }
    if (!Number.isInteger(this._workerLeaseMs) || this._workerLeaseMs <= 0) {
      throw new Error("workerLeaseMs must be a positive integer.");
    }
    this._recoverExpiredRuns();
    this._maintenanceTimer = setInterval(
      () => {
        if (this._closed) return;
        this._recoverExpiredRuns();
        this._scheduleDrain();
      },
      Math.max(250, Math.min(1_000, Math.floor(this._workerLeaseMs / 3)))
    );
    this._maintenanceTimer.unref?.();
    this._scheduleDrain();
  }

  createThread(input: CreateThreadInput = {}): Promise<Thread> {
    this._assertOpen();
    const now = this._clock();
    const threadId = this._generateId("thread");
    const checkpointId = this._generateId("checkpoint");
    const checkpoint: ThreadCheckpoint = {
      schemaVersion: 1,
      id: checkpointId,
      threadId,
      sequence: 1,
      source: { type: "thread.created" },
      threadState: _cloneThreadState(input.initialState ?? _emptyThreadState()),
      createdAt: now,
    };
    const thread: Thread = {
      schemaVersion: 1,
      id: threadId,
      headCheckpointId: checkpointId,
      createdAt: now,
      updatedAt: now,
    };
    this._options.store.transaction((tx) => {
      // Thread owns the Checkpoint foreign key. Insert the identity first;
      // `headCheckpointId` intentionally has no reverse FK so both rows can be
      // created atomically without deferring integrity checks.
      tx.insertThread(thread);
      tx.insertCheckpoint(checkpoint);
    });
    return Promise.resolve(structuredClone(thread));
  }

  getThread(threadId: string): Promise<Thread | undefined> {
    return Promise.resolve(
      this._options.store.transaction((tx) => tx.getThread(threadId))
    );
  }

  listThreads(): Promise<readonly Thread[]> {
    return Promise.resolve(
      this._options.store.transaction((tx) => tx.listThreads())
    );
  }

  getCheckpoint(checkpointId: string): Promise<ThreadCheckpoint | undefined> {
    return Promise.resolve(
      this._options.store.transaction((tx) => tx.getCheckpoint(checkpointId))
    );
  }

  listCheckpoints(threadId: string): Promise<readonly ThreadCheckpoint[]> {
    return Promise.resolve(
      this._options.store.transaction((tx) => tx.listCheckpoints(threadId))
    );
  }

  commitThreadState(input: CommitThreadStateInput): Promise<ThreadCheckpoint> {
    this._assertOpen();
    const checkpoint = this._options.store.transaction((tx) => {
      const thread = _requireThread(tx, input.threadId);
      if (thread.headCheckpointId !== input.expectedHeadCheckpointId) {
        throw new Error(`Thread "${input.threadId}" head changed.`);
      }
      _assertNoActiveRun(tx, thread.id);
      const parent = _requireCheckpoint(tx, thread.headCheckpointId);
      const next: ThreadCheckpoint = {
        schemaVersion: 1,
        id: this._generateId("checkpoint"),
        threadId: thread.id,
        parentCheckpointId: parent.id,
        sequence: parent.sequence + 1,
        source: { type: "manual" },
        threadState: _cloneThreadState(input.threadState),
        createdAt: this._clock(),
      };
      tx.insertCheckpoint(next);
      tx.saveThread(
        {
          ...thread,
          headCheckpointId: next.id,
          updatedAt: next.createdAt,
        },
        parent.id
      );
      return next;
    });
    return Promise.resolve(structuredClone(checkpoint));
  }

  forkThread(input: ForkThreadInput): Promise<Thread> {
    this._assertOpen();
    const fork = this._options.store.transaction((tx) => {
      const source = _requireThread(tx, input.threadId);
      const sourceCheckpoint = _requireCheckpoint(
        tx,
        input.checkpointId ?? source.headCheckpointId
      );
      if (sourceCheckpoint.threadId !== source.id) {
        throw new Error(
          `Checkpoint "${sourceCheckpoint.id}" does not belong to Thread "${source.id}".`
        );
      }
      return this._createChildThread(tx, source, sourceCheckpoint, "fork");
    });
    return Promise.resolve(structuredClone(fork.thread));
  }

  startRun(input: StartRunInput): Promise<Run> {
    this._assertOpen();
    if (input.inputMessages.length === 0) {
      throw new Error("startRun requires at least one input Message.");
    }
    const operationId = input.operationId ?? this._generateId("operation");
    const run = this._options.store.transaction((tx) => {
      const existing = tx.getRunByOperationId(operationId);
      if (existing !== undefined) {
        if (
          existing.threadId !== input.threadId ||
          existing.retryOfRunId !== undefined ||
          existing.baseCheckpointId !== input.expectedHeadCheckpointId ||
          !_sameJson(existing.inputMessages, input.inputMessages) ||
          !_sameJson(existing.agentSnapshot, input.agentSnapshot)
        ) {
          throw new Error(
            `Run operation "${operationId}" was reused with different startRun input.`
          );
        }
        return existing;
      }
      const thread = _requireThread(tx, input.threadId);
      if (thread.headCheckpointId !== input.expectedHeadCheckpointId) {
        throw new Error(`Thread "${thread.id}" head changed.`);
      }
      return this._insertRun(tx, {
        thread,
        baseCheckpoint: _requireCheckpoint(tx, thread.headCheckpointId),
        inputMessages: input.inputMessages,
        agentSnapshot: input.agentSnapshot,
        operationId,
      });
    });
    this._notify();
    this._scheduleDrain();
    return Promise.resolve(structuredClone(run));
  }

  retryRun(input: RetryRunInput): Promise<Run> {
    this._assertOpen();
    const operationId = input.operationId ?? this._generateId("operation");
    const run = this._options.store.transaction((tx) => {
      const existing = tx.getRunByOperationId(operationId);
      if (existing !== undefined) {
        if (existing.retryOfRunId !== input.runId) {
          throw new Error(
            `Run operation "${operationId}" was reused with different retryRun input.`
          );
        }
        return existing;
      }
      const original = _requireRun(tx, input.runId);
      const sourceThread = _requireThread(tx, original.threadId);
      const base = _requireCheckpoint(tx, original.baseCheckpointId);
      const child = this._createChildThread(tx, sourceThread, base, "retry");
      return this._insertRun(tx, {
        thread: child.thread,
        baseCheckpoint: child.checkpoint,
        inputMessages: original.inputMessages,
        agentSnapshot: original.agentSnapshot,
        operationId,
        retryOfRunId: original.id,
      });
    });
    this._notify();
    this._scheduleDrain();
    return Promise.resolve(structuredClone(run));
  }

  cancelRun(runId: string): Promise<void> {
    const outcome = this._options.store.transaction((tx) => {
      const run = tx.getRun(runId);
      if (run === undefined || _isTerminal(run.status)) return "unchanged";
      const now = this._clock();
      if (run.status === "running") {
        if (run.cancelRequestedAt === undefined) {
          const requested: Run = { ...run, cancelRequestedAt: now };
          tx.saveRun(requested);
          tx.appendRunEvent({
            runId,
            timestamp: now,
            event: { type: "run.updated", run: requested },
          });
        }
        return "requested";
      }
      const cancelled: Run = {
        ...run,
        status: "cancelled",
        workerId: undefined,
        leaseExpiresAt: undefined,
        completedAt: now,
      };
      tx.saveRun(cancelled);
      tx.appendRunEvent({
        runId,
        timestamp: now,
        event: { type: "run.updated", run: cancelled },
      });
      return "cancelled";
    });
    if (outcome === "requested") {
      this._activeRuns.get(runId)?.abort(new Error("Run was cancelled."));
    }
    if (outcome !== "unchanged") this._notify();
    return Promise.resolve();
  }

  getRun(runId: string): Promise<Run | undefined> {
    return Promise.resolve(
      this._options.store.transaction((tx) => tx.getRun(runId))
    );
  }

  getRunByOperationId(operationId: string): Promise<Run | undefined> {
    return Promise.resolve(
      this._options.store.transaction((tx) =>
        tx.getRunByOperationId(operationId)
      )
    );
  }

  listRuns(threadId: string): Promise<readonly Run[]> {
    return Promise.resolve(
      this._options.store.transaction((tx) => tx.listRuns(threadId))
    );
  }

  async *streamRun(
    runId: string,
    cursor: RunEventCursor = {}
  ): AsyncIterable<RunFrame> {
    let afterCursor = cursor.afterCursor ?? 0;
    const snapshot = this._options.store.transaction((tx) => {
      const run = _requireRun(tx, runId);
      const thread = _requireThread(tx, run.threadId);
      return {
        cursor: tx.latestRunEventCursor(runId),
        run,
        outputs: tx.listRunOutputs(runId),
        headCheckpointId: thread.headCheckpointId,
      };
    });
    yield { type: "snapshot", ...snapshot };
    afterCursor = Math.max(afterCursor, snapshot.cursor);
    if (!cursor.follow || _isTerminal(snapshot.run.status)) return;

    while (!cursor.signal?.aborted && !this._closed) {
      // Read the next batch and Run status from one Store snapshot. Otherwise
      // a Run can become terminal between two reads and make the subscriber
      // return before consuming the terminal event batch.
      const batch = this._options.store.transaction((tx) => ({
        events: tx.listRunEvents(runId, afterCursor),
        run: _requireRun(tx, runId),
      }));
      const { events } = batch;
      if (events.length === 0) {
        if (_isTerminal(batch.run.status)) return;
        await this._waitForEvent(cursor.signal);
        continue;
      }
      for (const event of events) {
        afterCursor = event.cursor;
        yield { type: "event", cursor: event.cursor, event: event.event };
      }
    }
  }

  /** Stop active work, release stream followers, and close the Engine Store. */
  close(): Promise<void> {
    this._closePromise ??= this._close();
    return this._closePromise;
  }

  private async _close(): Promise<void> {
    this._closed = true;
    clearInterval(this._maintenanceTimer);
    // Followers must observe `_closed` before the Store is released. Otherwise
    // a waiter can wake after SQLite closes and attempt one final transaction.
    this._notify();
    for (const controller of this._activeRuns.values()) {
      controller.abort(new EngineClosedError());
    }
    while (this._draining)
      await new Promise((resolve) => setTimeout(resolve, 0));
    this._options.store.close();
  }

  private _insertRun(
    tx: EngineStoreTransaction,
    input: {
      readonly thread: Thread;
      readonly baseCheckpoint: ThreadCheckpoint;
      readonly inputMessages: readonly Message[];
      readonly agentSnapshot: AgentSnapshot;
      readonly operationId: string;
      readonly retryOfRunId?: string;
    }
  ): Run {
    _assertNoActiveRun(tx, input.thread.id);
    const now = this._clock();
    const runId = this._generateId("run");
    const inputCheckpoint: ThreadCheckpoint = {
      schemaVersion: 1,
      id: this._generateId("checkpoint"),
      threadId: input.thread.id,
      parentCheckpointId: input.baseCheckpoint.id,
      sequence: input.baseCheckpoint.sequence + 1,
      source: { type: "run.input", runId },
      threadState: {
        messages: [
          ...structuredClone(input.baseCheckpoint.threadState.messages),
          ...structuredClone(input.inputMessages),
        ],
        state: structuredClone(input.baseCheckpoint.threadState.state),
      },
      createdAt: now,
    };
    const run: Run = {
      schemaVersion: 1,
      id: runId,
      threadId: input.thread.id,
      operationId: input.operationId,
      ...(input.retryOfRunId === undefined
        ? {}
        : { retryOfRunId: input.retryOfRunId }),
      inputMessages: structuredClone(input.inputMessages),
      baseCheckpointId: input.baseCheckpoint.id,
      inputCheckpointId: inputCheckpoint.id,
      agentSnapshot: structuredClone(input.agentSnapshot),
      status: "queued",
      createdAt: now,
    };
    tx.insertCheckpoint(inputCheckpoint);
    tx.saveThread(
      {
        ...input.thread,
        headCheckpointId: inputCheckpoint.id,
        updatedAt: now,
      },
      input.baseCheckpoint.id
    );
    tx.insertRun(run);
    tx.appendRunEvent({
      runId,
      timestamp: now,
      event: {
        type: "checkpoint.committed",
        checkpointId: inputCheckpoint.id,
        reason: "input",
      },
    });
    tx.appendRunEvent({
      runId,
      timestamp: now,
      event: { type: "run.updated", run },
    });
    return run;
  }

  private _createChildThread(
    tx: EngineStoreTransaction,
    source: Thread,
    sourceCheckpoint: ThreadCheckpoint,
    relationship: "retry" | "fork"
  ): { readonly thread: Thread; readonly checkpoint: ThreadCheckpoint } {
    const now = this._clock();
    const threadId = this._generateId("thread");
    const checkpoint: ThreadCheckpoint = {
      schemaVersion: 1,
      id: this._generateId("checkpoint"),
      threadId,
      sequence: 1,
      source: {
        type: "thread.forked",
        sourceThreadId: source.id,
        sourceCheckpointId: sourceCheckpoint.id,
      },
      threadState: _cloneThreadState(sourceCheckpoint.threadState),
      createdAt: now,
    };
    const thread: Thread = {
      schemaVersion: 1,
      id: threadId,
      parent: {
        threadId: source.id,
        relationship,
        sourceCheckpointId: sourceCheckpoint.id,
      },
      headCheckpointId: checkpoint.id,
      createdAt: now,
      updatedAt: now,
    };
    // See createThread(): the child identity must exist before its first
    // Checkpoint when foreign-key enforcement is enabled.
    tx.insertThread(thread);
    tx.insertCheckpoint(checkpoint);
    return { thread, checkpoint };
  }

  private _scheduleDrain(): void {
    if (this._closed || this._draining) return;
    queueMicrotask(() => void this._drain());
  }

  private async _drain(): Promise<void> {
    if (this._closed || this._draining) return;
    this._draining = true;
    try {
      while (!this._closed) {
        const run = this._options.store.transaction((tx) => {
          const claimed = tx.claimQueuedRun({
            workerId: this._workerId,
            now: this._clock(),
            leaseExpiresAt: this._clock() + this._workerLeaseMs,
          });
          if (claimed !== undefined) {
            tx.appendRunEvent({
              runId: claimed.id,
              timestamp: this._clock(),
              event: { type: "run.updated", run: claimed },
            });
          }
          return claimed;
        });
        if (run === undefined) break;
        this._notify();
        await this._executeRun(run);
      }
    } finally {
      this._draining = false;
    }
  }

  private async _executeRun(run: Run): Promise<void> {
    const controller = new AbortController();
    this._activeRuns.set(run.id, controller);
    const heartbeat = setInterval(
      () => this._renewLease(run.id),
      Math.max(100, Math.floor(this._workerLeaseMs / 3))
    );
    heartbeat.unref?.();
    try {
      const agent = await this._options.agentResolver.resolve(
        run.agentSnapshot
      );
      _assertExactAgent(run.agentSnapshot, agent);
      const inputCheckpoint = this._options.store.transaction((tx) =>
        _requireCheckpoint(tx, run.inputCheckpointId)
      );
      const stateContext = createAgentStateContext(
        inputCheckpoint.threadState.state
      );
      await stateContext.run(() =>
        this._executeModelLoop(
          run,
          agent,
          inputCheckpoint,
          () => stateContext.snapshot(),
          controller.signal
        )
      );
    } catch (error) {
      const interrupted = error instanceof EngineClosedError;
      const cancelled = controller.signal.aborted && !interrupted;
      this._finishRunWithError(run.id, error, interrupted, cancelled);
    } finally {
      clearInterval(heartbeat);
      this._activeRuns.delete(run.id);
      this._notify();
    }
  }

  private async _executeModelLoop(
    run: Run,
    agent: ExecutableAgent,
    initialCheckpoint: ThreadCheckpoint,
    stateSnapshot: () => Readonly<Record<string, JsonValue>>,
    signal: AbortSignal
  ): Promise<void> {
    let checkpoint = initialCheckpoint;
    let messages = structuredClone(initialCheckpoint.threadState.messages);
    for (let stepIndex = 0; stepIndex < this._maxModelTurns; stepIndex++) {
      _throwIfAborted(signal);
      const messageId = this._generateId("message");
      let text = "";
      let thinking = "";
      const toolCalls: ToolCall[] = [];
      let finish: Extract<ModelTurnEvent, { type: "finish" }> | undefined;
      let bufferedText = "";
      let bufferedThinking = "";
      let bufferedEvents = 0;
      let lastFlushAt = this._clock();

      const flush = () => {
        if (bufferedText.length === 0 && bufferedThinking.length === 0) return;
        this._flushDelta(run.id, _assistantDraft(messageId, text, thinking), {
          text: bufferedText,
          thinking: bufferedThinking,
        });
        bufferedText = "";
        bufferedThinking = "";
        bufferedEvents = 0;
        lastFlushAt = this._clock();
      };

      for await (const event of this._options.modelDriver.run(
        {
          agentId: agent.snapshot.agentId,
          instructions: agent.snapshot.instructions,
          messages,
          model: agent.snapshot.model,
          tools: agent.snapshot.tools,
        },
        { signal }
      )) {
        _throwIfAborted(signal);
        if (finish !== undefined) {
          throw new Error("Model turn emitted data after its finish event.");
        }
        if (event.type === "text.delta") {
          text += event.delta;
          bufferedText += event.delta;
          bufferedEvents++;
        } else if (event.type === "thinking.delta") {
          thinking += event.delta;
          bufferedThinking += event.delta;
          bufferedEvents++;
        } else if (event.type === "tool.call") {
          toolCalls.push({
            id: event.call.id,
            input: {
              name: event.call.name,
              arguments: structuredClone(event.call.arguments),
            },
          });
        } else {
          finish = event;
        }
        if (
          bufferedEvents === 1 ||
          bufferedEvents >= DELTA_FLUSH_EVENT_COUNT ||
          bufferedText.length + bufferedThinking.length >= DELTA_FLUSH_SIZE ||
          this._clock() - lastFlushAt >= DELTA_FLUSH_INTERVAL_MS
        ) {
          flush();
        }
      }
      flush();
      _assertFinish(finish?.reason, toolCalls);

      const assistant: AssistantMessage = {
        id: messageId,
        role: "assistant",
        content: text.length === 0 ? [] : [{ type: "text", text }],
        ...(thinking.length === 0 ? {} : { thinking }),
        ...(toolCalls.length === 0 ? {} : { toolCalls }),
        ...(finish?.usage === undefined ? {} : { usage: finish.usage }),
        ...(finish?.responseOutputItems === undefined
          ? {}
          : { responseOutputItems: [...finish.responseOutputItems] }),
      };
      messages = [...messages, assistant];
      checkpoint = this._commitStep({
        runId: run.id,
        parent: checkpoint,
        messages,
        state: stateSnapshot(),
        step: "model.completed",
        output: {
          runId: run.id,
          message: assistant,
          status: "completed",
          updatedAt: this._clock(),
        },
        event: { type: "message.completed", message: assistant },
      });

      if (toolCalls.length === 0) {
        this._completeRun(run.id, checkpoint.id);
        return;
      }

      for (const call of toolCalls) {
        _throwIfAborted(signal);
        this._appendEvent(run.id, {
          type: "tool.started",
          messageId,
          toolCallId: call.id,
          toolName: call.input.name,
        });
        const output = await this._executeTool(
          run,
          agent,
          call,
          stepIndex,
          signal
        );
        messages = _setToolOutput(messages, messageId, call.id, output);
        const updated = messages.find(
          (message): message is AssistantMessage =>
            message.id === messageId && message.role === "assistant"
        );
        if (updated === undefined)
          throw new Error(`Assistant Message "${messageId}" was lost.`);
        checkpoint = this._commitStep({
          runId: run.id,
          parent: checkpoint,
          messages,
          state: stateSnapshot(),
          step: "tool.completed",
          output: {
            runId: run.id,
            message: updated,
            status: "completed",
            updatedAt: this._clock(),
          },
          event: {
            type: "tool.completed",
            messageId,
            toolCallId: call.id,
            message: updated,
          },
        });
      }
    }
    throw new Error(
      `Run exceeded ${this._maxModelTurns} model turns without completing.`
    );
  }

  private async _executeTool(
    run: Run,
    agent: ExecutableAgent,
    call: ToolCall,
    stepIndex: number,
    signal: AbortSignal
  ): Promise<ToolCallOutput> {
    const prepared = agent.tools.get(call.input.name);
    if (prepared === undefined) {
      return _errorToolOutput(`Unknown tool: ${call.input.name}`);
    }
    try {
      const validated = await validateSchemaValue(
        prepared.definition.inputSchema,
        call.input.arguments,
        { direction: "input", label: `Input for tool "${call.input.name}"` }
      );
      const context = this._options.createToolContext({
        execution: {
          threadId: run.threadId,
          runId: run.id,
          stepIndex,
          callId: call.id,
          toolName: call.input.name,
        },
        signal,
      });
      const execution = prepared.definition.execute(validated, context);
      let value: unknown;
      if (_isAsyncIterable(execution)) {
        for await (const part of execution) value = part;
      } else {
        value = await execution;
      }
      if (prepared.definition.outputSchema !== undefined) {
        value = await validateSchemaValue(
          prepared.definition.outputSchema,
          value,
          {
            direction: "output",
            label: `Output from tool "${call.input.name}"`,
          }
        );
      }
      const modelOutput =
        prepared.definition.toModelOutput === undefined
          ? _defaultModelOutput(value)
          : await prepared.definition.toModelOutput(value);
      return _toolCallOutput(modelOutput, false);
    } catch (error) {
      if (signal.aborted) throw error;
      return _errorToolOutput(_errorMessage(error));
    }
  }

  private _commitStep(input: {
    readonly runId: string;
    readonly parent: ThreadCheckpoint;
    readonly messages: readonly Message[];
    readonly state: Readonly<Record<string, JsonValue>>;
    readonly step: "model.completed" | "tool.completed";
    readonly output: RunOutputSnapshot;
    readonly event: Extract<
      RunEvent["event"],
      { type: "message.completed" | "tool.completed" }
    >;
  }): ThreadCheckpoint {
    const checkpoint = this._options.store.transaction((tx) => {
      const run = _requireRun(tx, input.runId);
      _assertWorkerOwns(run, this._workerId);
      const thread = _requireThread(tx, run.threadId);
      if (thread.headCheckpointId !== input.parent.id) {
        throw new Error(`Thread "${thread.id}" head changed during Run.`);
      }
      const now = this._clock();
      const next: ThreadCheckpoint = {
        schemaVersion: 1,
        id: this._generateId("checkpoint"),
        threadId: thread.id,
        parentCheckpointId: input.parent.id,
        sequence: input.parent.sequence + 1,
        source: { type: "run.step", runId: run.id, step: input.step },
        threadState: {
          messages: structuredClone(input.messages),
          state: structuredClone(input.state),
        },
        createdAt: now,
      };
      tx.insertCheckpoint(next);
      tx.saveThread(
        { ...thread, headCheckpointId: next.id, updatedAt: now },
        input.parent.id
      );
      tx.upsertRunOutput(input.output);
      tx.appendRunEvent({ runId: run.id, timestamp: now, event: input.event });
      tx.appendRunEvent({
        runId: run.id,
        timestamp: now,
        event: {
          type: "checkpoint.committed",
          checkpointId: next.id,
          reason: "step",
        },
      });
      return next;
    });
    this._notify();
    return checkpoint;
  }

  private _flushDelta(
    runId: string,
    message: AssistantMessage,
    delta: { readonly text: string; readonly thinking: string }
  ): void {
    const now = this._clock();
    this._options.store.transaction((tx) => {
      const run = _requireRun(tx, runId);
      _assertWorkerOwns(run, this._workerId);
      tx.upsertRunOutput({
        runId,
        message,
        status: "streaming",
        updatedAt: now,
      });
      if (delta.text.length > 0) {
        tx.appendRunEvent({
          runId,
          timestamp: now,
          event: {
            type: "message.delta",
            messageId: message.id,
            delta: delta.text,
          },
        });
      }
      if (delta.thinking.length > 0) {
        tx.appendRunEvent({
          runId,
          timestamp: now,
          event: {
            type: "thinking.delta",
            messageId: message.id,
            delta: delta.thinking,
          },
        });
      }
    });
    this._notify();
  }

  private _completeRun(runId: string, resultCheckpointId: string): void {
    const now = this._clock();
    this._options.store.transaction((tx) => {
      const run = _requireRun(tx, runId);
      _assertWorkerOwns(run, this._workerId);
      if (run.cancelRequestedAt !== undefined) {
        this._recoverRunInTransaction(
          tx,
          run,
          "cancelled",
          "Run was cancelled.",
          now
        );
        return;
      }
      const completed: Run = {
        ...run,
        status: "completed",
        resultCheckpointId,
        workerId: undefined,
        leaseExpiresAt: undefined,
        completedAt: now,
      };
      tx.saveRun(completed);
      tx.appendRunEvent({
        runId,
        timestamp: now,
        event: { type: "run.updated", run: completed },
      });
    });
    this._notify();
  }

  private _finishRunWithError(
    runId: string,
    error: unknown,
    interrupted: boolean,
    cancelled: boolean
  ): void {
    if (interrupted) {
      this._recoverRun(runId, "interrupted", _errorMessage(error));
      return;
    }
    if (cancelled) {
      // A running tool may have produced external side effects before the
      // abort was observed. Persist the same synthetic output used for worker
      // interruption so the Thread never resumes with an unresolved call.
      this._recoverRun(runId, "cancelled", _errorMessage(error));
      return;
    }
    const now = this._clock();
    this._options.store.transaction((tx) => {
      const run = tx.getRun(runId);
      if (run === undefined || _isTerminal(run.status)) return;
      if (run.cancelRequestedAt !== undefined) {
        this._recoverRunInTransaction(
          tx,
          run,
          "cancelled",
          "Run was cancelled.",
          now
        );
        return;
      }
      const failed: Run = {
        ...run,
        status: "failed",
        workerId: undefined,
        leaseExpiresAt: undefined,
        completedAt: now,
        error: {
          code: "execution_failed",
          message: _errorMessage(error),
        },
      };
      tx.saveRun(failed);
      tx.appendRunEvent({
        runId,
        timestamp: now,
        event: { type: "run.updated", run: failed },
      });
    });
  }

  private _recoverExpiredRuns(): void {
    const now = this._clock();
    const expired = this._options.store.transaction((tx) =>
      tx.listExpiredRunningRuns(now)
    );
    let recovered = false;
    for (const candidate of expired) {
      if (
        (this._activeRuns.has(candidate.id) &&
          candidate.cancelRequestedAt === undefined) ||
        candidate.leaseExpiresAt === undefined
      ) {
        continue;
      }
      const expectedLeaseExpiresAt = candidate.leaseExpiresAt;
      recovered =
        this._options.store.transaction((tx) => {
          // Claim by the exact observed lease before applying recovery. A
          // heartbeat that renewed the lease after the scan makes this CAS
          // fail, so a live Run cannot be interrupted from a stale snapshot.
          const claimed = tx.claimExpiredRun({
            runId: candidate.id,
            ...(candidate.workerId === undefined
              ? {}
              : { expectedWorkerId: candidate.workerId }),
            expectedLeaseExpiresAt,
            workerId: this._workerId,
            now,
            leaseExpiresAt: now + this._workerLeaseMs,
          });
          if (claimed === undefined) return false;
          const cancelled = claimed.cancelRequestedAt !== undefined;
          this._recoverRunInTransaction(
            tx,
            claimed,
            cancelled ? "cancelled" : "interrupted",
            cancelled ? "Run was cancelled." : "Worker lease expired.",
            now
          );
          return true;
        }) || recovered;
    }
    if (recovered) this._notify();
  }

  private _recoverRun(
    runId: string,
    status: "interrupted" | "cancelled",
    message: string
  ): void {
    const now = this._clock();
    this._options.store.transaction((tx) => {
      const run = tx.getRun(runId);
      if (run === undefined || _isTerminal(run.status)) return;
      this._recoverRunInTransaction(
        tx,
        run,
        run.cancelRequestedAt === undefined ? status : "cancelled",
        run.cancelRequestedAt === undefined ? message : "Run was cancelled.",
        now
      );
    });
    this._notify();
  }

  private _recoverRunInTransaction(
    tx: EngineStoreTransaction,
    run: Run,
    status: "interrupted" | "cancelled",
    message: string,
    now: number
  ): void {
    const thread = _requireThread(tx, run.threadId);
    const head = _requireCheckpoint(tx, thread.headCheckpointId);
    const recovered = _withInterruptedToolOutputs(head.threadState);
    let headCheckpointId = head.id;
    if (recovered !== undefined) {
      const recovery: ThreadCheckpoint = {
        schemaVersion: 1,
        id: this._generateId("checkpoint"),
        threadId: thread.id,
        parentCheckpointId: head.id,
        sequence: head.sequence + 1,
        source: { type: "run.recovery", runId: run.id },
        threadState: recovered.threadState,
        createdAt: now,
      };
      tx.insertCheckpoint(recovery);
      tx.saveThread(
        { ...thread, headCheckpointId: recovery.id, updatedAt: now },
        head.id
      );
      tx.appendRunEvent({
        runId: run.id,
        timestamp: now,
        event: {
          type: "checkpoint.committed",
          checkpointId: recovery.id,
          reason: "recovery",
        },
      });
      headCheckpointId = recovery.id;
      for (const output of recovered.outputs) {
        tx.upsertRunOutput({
          runId: run.id,
          message: output.message,
          status: "completed",
          updatedAt: now,
        });
        for (const toolCallId of output.toolCallIds) {
          tx.appendRunEvent({
            runId: run.id,
            timestamp: now,
            event: {
              type: "tool.completed",
              messageId: output.message.id,
              toolCallId,
              message: output.message,
            },
          });
        }
      }
    }
    const terminal: Run = {
      ...run,
      status,
      workerId: undefined,
      leaseExpiresAt: undefined,
      completedAt: now,
      ...(status === "interrupted"
        ? { error: { code: "execution_interrupted", message } }
        : { resultCheckpointId: headCheckpointId }),
    };
    tx.saveRun(terminal);
    tx.appendRunEvent({
      runId: run.id,
      timestamp: now,
      event: { type: "run.updated", run: terminal },
    });
  }

  private _renewLease(runId: string): void {
    if (this._closed) return;
    const cancelRequested = this._options.store.transaction((tx) => {
      const run = tx.getRun(runId);
      if (run?.status !== "running" || run.workerId !== this._workerId) {
        return false;
      }
      if (run.cancelRequestedAt !== undefined) return true;
      tx.saveRun({
        ...run,
        leaseExpiresAt: this._clock() + this._workerLeaseMs,
      });
      return false;
    });
    if (cancelRequested) {
      this._activeRuns.get(runId)?.abort(new Error("Run was cancelled."));
    }
  }

  private _appendEvent(runId: string, event: RunEvent["event"]): void {
    this._options.store.transaction((tx) => {
      tx.appendRunEvent({ runId, timestamp: this._clock(), event });
    });
    this._notify();
  }

  private _waitForEvent(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", done);
        this._waiters.delete(done);
        resolve();
      };
      const timeout = setTimeout(done, 250);
      timeout.unref?.();
      this._waiters.add(done);
      signal?.addEventListener("abort", done, { once: true });
    });
  }

  private _notify(): void {
    for (const waiter of [...this._waiters]) waiter();
  }

  private _assertOpen(): void {
    if (this._closed) throw new Error("AgentEngine is closed.");
  }
}

class EngineClosedError extends Error {
  constructor() {
    super("AgentEngine closed while Run was active.");
    this.name = "EngineClosedError";
  }
}

function _requireThread(tx: EngineStoreTransaction, threadId: string): Thread {
  const thread = tx.getThread(threadId);
  if (thread === undefined)
    throw new Error(`Thread "${threadId}" was not found.`);
  return thread;
}

function _requireCheckpoint(
  tx: EngineStoreTransaction,
  checkpointId: string
): ThreadCheckpoint {
  const checkpoint = tx.getCheckpoint(checkpointId);
  if (checkpoint === undefined) {
    throw new Error(`Checkpoint "${checkpointId}" was not found.`);
  }
  return checkpoint;
}

function _requireRun(tx: EngineStoreTransaction, runId: string): Run {
  const run = tx.getRun(runId);
  if (run === undefined) throw new Error(`Run "${runId}" was not found.`);
  return run;
}

function _assertNoActiveRun(
  tx: EngineStoreTransaction,
  threadId: string
): void {
  if (
    tx
      .listRuns(threadId)
      .some((run) => run.status === "queued" || run.status === "running")
  ) {
    throw new Error(`Thread "${threadId}" already has an active Run.`);
  }
}

function _assertWorkerOwns(run: Run, workerId: string): void {
  if (run.status !== "running" || run.workerId !== workerId) {
    throw new Error(`Run "${run.id}" is not owned by Worker "${workerId}".`);
  }
}

function _assertExactAgent(
  snapshot: AgentSnapshot,
  executable: ExecutableAgent
): void {
  if (!_sameJson(executable.snapshot, snapshot)) {
    throw new Error(
      `Agent generation "${snapshot.agentId}/${snapshot.generationId}" is unavailable.`
    );
  }
}

function _emptyThreadState(): ThreadState {
  return { messages: [], state: {} };
}

function _cloneThreadState(state: ThreadState): ThreadState {
  return structuredClone(state);
}

function _assistantDraft(
  id: string,
  text: string,
  thinking: string
): AssistantMessage {
  return {
    id,
    role: "assistant",
    content: text.length === 0 ? [] : [{ type: "text", text }],
    ...(thinking.length === 0 ? {} : { thinking }),
  };
}

function _assertFinish(
  reason: Extract<ModelTurnEvent, { type: "finish" }>["reason"] | undefined,
  toolCalls: readonly ToolCall[]
): void {
  if (reason === undefined)
    throw new Error("Model turn ended without a finish event.");
  if (reason === "length") {
    throw new Error("Model turn stopped because its output limit was reached.");
  }
  if (reason === "other")
    throw new Error("Model turn ended for an unsupported reason.");
  if (toolCalls.length > 0 && reason !== "tool-calls") {
    throw new Error(`Model emitted tool calls with finish reason "${reason}".`);
  }
  if (toolCalls.length === 0 && reason !== "stop") {
    throw new Error(`Model finished as "${reason}" without tool calls.`);
  }
}

function _setToolOutput(
  messages: readonly Message[],
  messageId: string,
  toolCallId: string,
  output: ToolCallOutput
): Message[] {
  return messages.map((message) =>
    message.id !== messageId || message.role !== "assistant"
      ? message
      : {
          ...message,
          toolCalls: message.toolCalls?.map((call) =>
            call.id === toolCallId ? { ...call, output } : call
          ),
        }
  );
}

function _withInterruptedToolOutputs(state: ThreadState):
  | {
      readonly threadState: ThreadState;
      readonly outputs: readonly {
        readonly message: AssistantMessage;
        readonly toolCallIds: readonly string[];
      }[];
    }
  | undefined {
  let changed = false;
  const outputs: {
    readonly message: AssistantMessage;
    readonly toolCallIds: readonly string[];
  }[] = [];
  const messages = state.messages.map((message) => {
    if (message.role !== "assistant" || message.toolCalls === undefined) {
      return message;
    }
    const toolCallIds: string[] = [];
    const toolCalls = message.toolCalls.map((call) => {
      if (call.output !== undefined) return call;
      changed = true;
      toolCallIds.push(call.id);
      return {
        ...call,
        output: _errorToolOutput(
          "Tool execution was interrupted. Its external side effects are unknown; the tool was not automatically retried."
        ),
      };
    });
    const recovered = { ...message, toolCalls };
    if (toolCallIds.length > 0) {
      outputs.push({ message: recovered, toolCallIds });
    }
    return recovered;
  });
  return changed
    ? {
        threadState: { messages, state: structuredClone(state.state) },
        outputs,
      }
    : undefined;
}

function _sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function _toolCallOutput(
  output: ToolModelOutput,
  isError: boolean
): ToolCallOutput {
  if (output.type === "text") {
    return { content: [{ type: "text", text: output.value }], isError };
  }
  if (output.type === "json") {
    return {
      content: [{ type: "text", text: JSON.stringify(output.value) ?? "null" }],
      isError,
    };
  }
  return {
    content: output.value.map((part) =>
      part.type === "text"
        ? { type: "text" as const, text: part.text }
        : part.mediaType.startsWith("image/")
          ? {
              type: "image" as const,
              mimeType: part.mediaType,
              data: part.data.data,
            }
          : {
              type: "text" as const,
              text:
                part.filename === undefined
                  ? `[${part.mediaType} file]`
                  : `[${part.mediaType} file: ${part.filename}]`,
            }
    ),
    isError,
  };
}

function _errorToolOutput(message: string): ToolCallOutput {
  return { content: [{ type: "text", text: message }], isError: true };
}

function _defaultModelOutput(value: unknown): ToolModelOutput {
  return typeof value === "string"
    ? { type: "text", value }
    : { type: "json", value };
}

function _isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    Symbol.asyncIterator in value &&
    typeof (value as AsyncIterable<unknown>)[Symbol.asyncIterator] ===
      "function"
  );
}

function _throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason ?? new Error("Run was cancelled.");
}

function _isTerminal(status: Run["status"]): boolean {
  return (
    status === "completed" ||
    status === "failed" ||
    status === "cancelled" ||
    status === "interrupted"
  );
}

function _errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
