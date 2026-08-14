import {
  type AgentMessage,
  type Entry,
  type LaneRecord,
  type LogItem,
  type OperationStartedRecord,
  type ProvisionedEntry,
  type Session,
  type SessionMetadata,
  type SessionRepo,
  type SessionTree,
} from "@earendil-works/pi-agent-core";
import type { AssistantMessage, Usage } from "@earendil-works/pi-ai";
import type {
  ToolContext,
  ToolDefinition,
  ToolModelOutput,
} from "@llm-space/agent/tools";
import { validateSchemaValue } from "@llm-space/agent/tools/schema-validation";

import {
  RuntimeBindingResolutionError,
  type BunSqliteRuntimeBindingStore,
  type RuntimeBinding,
  type RuntimeBindingReference,
} from "../bindings/bun-sqlite-runtime-binding-store";
const DEFAULT_LANE = "main";
const BINDING_EXTENSION = "llm-space";

export interface AssistantExecutor {
  /** Checks the frozen model identity without starting a provider request. */
  checkAvailability?(
    binding: RuntimeBinding
  ): AssistantAvailability | Promise<AssistantAvailability>;
  /** Executes exactly one provider turn and never executes local tools. */
  execute(input: {
    readonly operationId: string;
    readonly binding: RuntimeBinding;
    readonly messages: readonly AgentMessage[];
    readonly signal: AbortSignal;
    readonly onDelta?: (event: RuntimeEphemeralEvent) => void | Promise<void>;
  }): Promise<AssistantMessage>;
}

export type AssistantAvailability =
  | { readonly available: true }
  | { readonly available: false; readonly message: string };

export interface RuntimeTool {
  /** Authored generics are restored by schema validation at this boundary. */
  readonly definition: ToolDefinition;
  /** Immutable implementation identity resolved from the Studio tool registry. */
  readonly implementationId: string;
  readonly isErrorResult?: (output: unknown) => boolean;
}

/** Erases authored tool generics at the validated dynamic-registry boundary. */
export function runtimeTool<TInput, TOutput>(
  definition: ToolDefinition<TInput, TOutput>,
  options: {
    readonly implementationId: string;
    readonly isErrorResult?: (output: TOutput) => boolean;
  }
): RuntimeTool {
  return {
    definition: definition as ToolDefinition,
    implementationId: options.implementationId,
    ...(options.isErrorResult === undefined
      ? {}
      : {
          isErrorResult: (output) => options.isErrorResult!(output as TOutput),
        }),
  };
}

export interface BeforeToolPolicyResult {
  readonly effectiveArgs?: Record<string, unknown>;
  readonly blocked?: boolean;
  readonly message?: string;
}

export interface AfterToolPolicyResult {
  readonly modelOutput?: ToolModelOutput;
  readonly details?: unknown;
  readonly isError?: boolean;
  readonly usage?: Usage;
}

export interface ToolPolicies {
  /** Runs before `tool_started`; blocked calls never admit an external effect. */
  readonly before?: (input: {
    readonly binding: RuntimeBinding;
    readonly tool: RuntimeTool;
    readonly action: Extract<SemanticAction, { kind: "tool" }>;
    readonly args: Readonly<Record<string, unknown>>;
    readonly signal: AbortSignal;
  }) => BeforeToolPolicyResult | Promise<BeforeToolPolicyResult>;
  /** Finalizes a settled tool result before usage and result materialization. */
  readonly after?: (input: {
    readonly binding: RuntimeBinding;
    readonly tool: RuntimeTool;
    readonly action: Extract<SemanticAction, { kind: "tool" }>;
    readonly output: unknown;
    readonly modelOutput: ToolModelOutput;
    readonly isError: boolean;
    readonly signal: AbortSignal;
  }) => AfterToolPolicyResult | Promise<AfterToolPolicyResult>;
}

export class DurableEffectCrash extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DurableEffectCrash";
  }
}

export type RuntimeEphemeralEvent =
  | { readonly type: "assistant.text_delta"; readonly delta: string }
  | { readonly type: "assistant.thinking_delta"; readonly delta: string };

export type SemanticAction =
  | { readonly id: string; readonly kind: "model"; readonly attempt: number }
  | {
      readonly id: string;
      readonly kind: "tool";
      readonly assistantEntryId: string;
      readonly toolIndex: number;
      readonly toolCallId: string;
      readonly toolName: string;
    };

export interface PiSessionSnapshot {
  /** Latest committed Pi log sequence observed while reducing this snapshot. */
  readonly cursor: number;
  readonly sessionId: string;
  readonly lane: string;
  readonly operationId?: string;
  readonly status:
    "idle" | "paused" | "suspended" | "completed" | "failed" | "aborted";
  /** Stable Pi message entries used by product and protocol projections. */
  readonly messageEntries: readonly Extract<Entry, { type: "message" }>[];
  readonly messages: readonly AgentMessage[];
  readonly leafId: string | null;
  readonly nextAction?: SemanticAction;
  readonly suspension?: {
    readonly code:
      | "missing_binding"
      | "binding_hash_mismatch"
      | "binding_format_mismatch"
      | "missing_model_identity"
      | "missing_tool_identity"
      | "tool_identity_mismatch";
    readonly message: string;
  };
}

export interface PiCommittedChange {
  /** Cursor from which this frame was read; replay uses it until the frame barrier. */
  readonly fromCursor: number;
  /** Last sequence included in `items`; pass it back as `afterSeq` on reconnect. */
  readonly cursor: number;
  readonly items: readonly LogItem[];
  readonly snapshot: PiSessionSnapshot;
}

export interface PiOperationSnapshot {
  readonly sessionId: string;
  readonly lane: string;
  readonly operationId: string;
  readonly status:
    "paused" | "suspended" | "completed" | "failed" | "aborted" | "declined";
  readonly sourceLeafId: string | null;
  readonly leafId: string | null;
  /** Complete active-branch transcript through this operation's leaf. */
  readonly conversationEntries: readonly Extract<Entry, { type: "message" }>[];
  /** Entries committed specifically by this operation. */
  readonly messageEntries: readonly Extract<Entry, { type: "message" }>[];
  readonly startedAt: number;
  readonly finishedAt?: number;
}

export class StaleSemanticActionError extends Error {
  constructor(expected: string, actual: string | undefined) {
    super(
      `Semantic action "${expected}" is stale; current action is "${actual ?? "none"}".`
    );
    this.name = "StaleSemanticActionError";
  }
}

export class SemanticActionKindError extends Error {
  constructor(expected: "model" | "tool", actual: "model" | "tool") {
    super(
      `Expected a ${expected} action, but the durable next action is ${actual}.`
    );
    this.name = "SemanticActionKindError";
  }
}

export class OperationAdmissionConflictError extends Error {
  constructor(readonly operationId: string) {
    super(`Operation "${operationId}" was already admitted with other input.`);
    this.name = "OperationAdmissionConflictError";
  }
}

export class DurableSessionCorruptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DurableSessionCorruptionError";
  }
}

interface ActiveLaneEffect {
  readonly controller: AbortController;
  readonly settled: Promise<void>;
  settle(): void;
}

/**
 * Product-facing facade for the implemented durable Pi subset.
 *
 * Open is read-only. Start only admits durable intent. Step releases exactly
 * one semantic model/tool effect boundary.
 */
export class StudioPiSessionRuntime {
  private readonly _repository: SessionRepo;
  private readonly _bindings: BunSqliteRuntimeBindingStore;
  private readonly _assistantExecutor: AssistantExecutor;
  private readonly _maxModelAttempts: number;
  private readonly _resolveTools: (
    binding: RuntimeBinding
  ) =>
    | ReadonlyMap<string, RuntimeTool>
    | Promise<ReadonlyMap<string, RuntimeTool>>;
  private readonly _createToolContext?: (input: {
    readonly execution: ToolContext["execution"];
    readonly signal: AbortSignal;
  }) => ToolContext;
  private readonly _toolPolicies: ToolPolicies;
  private readonly _sessions = new Map<string, Session>();
  private readonly _activeEffects = new Map<string, ActiveLaneEffect>();
  private readonly _listeners = new Map<
    string,
    Set<(event: RuntimeEphemeralEvent) => void | Promise<void>>
  >();
  private readonly _closeController = new AbortController();
  private _closed = false;
  private _closePromise: Promise<void> | undefined;

  constructor(options: {
    readonly repository: SessionRepo;
    readonly bindings: BunSqliteRuntimeBindingStore;
    readonly assistantExecutor: AssistantExecutor;
    readonly maxModelAttempts?: number;
    readonly resolveTools?: (
      binding: RuntimeBinding
    ) =>
      | ReadonlyMap<string, RuntimeTool>
      | Promise<ReadonlyMap<string, RuntimeTool>>;
    readonly createToolContext?: (input: {
      readonly execution: ToolContext["execution"];
      readonly signal: AbortSignal;
    }) => ToolContext;
    readonly toolPolicies?: ToolPolicies;
  }) {
    this._repository = options.repository;
    this._bindings = options.bindings;
    this._assistantExecutor = options.assistantExecutor;
    this._maxModelAttempts = options.maxModelAttempts ?? 3;
    if (
      !Number.isSafeInteger(this._maxModelAttempts) ||
      this._maxModelAttempts <= 0
    ) {
      throw new RangeError("maxModelAttempts must be a positive integer.");
    }
    this._resolveTools = options.resolveTools ?? (() => new Map());
    this._createToolContext = options.createToolContext;
    this._toolPolicies = options.toolPolicies ?? {};
  }

  /** Creates a Pi Session without starting an operation or external effect. */
  async createSession(
    options: { readonly id?: string } = {}
  ): Promise<PiSessionSnapshot> {
    this._requireOpen();
    const session = await this._repository.create(options);
    const metadata = await session.getMetadata();
    this._sessions.set(metadata.id, session);
    return this._snapshot(session, DEFAULT_LANE);
  }

  /** Forks one committed Pi branch into a new independently writable Session. */
  async forkSession(input: {
    readonly sessionId: string;
    readonly entryId?: string;
    readonly id?: string;
  }): Promise<PiSessionSnapshot> {
    this._requireOpen();
    const source = await this._session(input.sessionId);
    const metadata = await source.getMetadata();
    const fork = await this._repository.fork(metadata, {
      scope: "branch",
      ...(input.entryId === undefined
        ? {}
        : { entryId: input.entryId, position: "at" }),
      ...(input.id === undefined ? {} : { id: input.id }),
      parentSessionId: input.sessionId,
    });
    const forkMetadata = await fork.getMetadata();
    this._sessions.set(forkMetadata.id, fork);
    return this._snapshot(fork, DEFAULT_LANE);
  }

  /** Reconstructs a snapshot from committed Pi data with zero writes/effects. */
  async open(input: {
    readonly sessionId: string;
    readonly lane?: string;
  }): Promise<PiSessionSnapshot> {
    this._requireOpen();
    const session = await this._session(input.sessionId);
    return this._snapshot(session, input.lane ?? DEFAULT_LANE);
  }

  /**
   * Freezes the runtime binding, admits the Pi operation, then materializes its
   * initial messages. No provider or tool is invoked.
   */
  async start(input: {
    readonly operationId: string;
    readonly sessionId: string;
    readonly lane?: string;
    readonly messages: AgentMessage[];
    readonly binding: RuntimeBinding;
  }): Promise<PiSessionSnapshot> {
    this._requireOpen();
    const lane = input.lane ?? DEFAULT_LANE;
    const session = await this._session(input.sessionId);
    const binding = this._bindings.put({
      id: `binding:${input.operationId}`,
      binding: input.binding,
    });
    const existing = await session.findRecords({
      type: "operation_started",
      runId: input.operationId,
      limit: 1,
    });
    let operation = existing[0];
    if (operation === undefined) {
      const open = await session.findOpenOperations(lane, { limit: 1 });
      if (open.length > 0) {
        throw new Error(`Lane "${lane}" already has an open operation.`);
      }
      const initialMessages = input.messages.map((message, index) => ({
        type: "message" as const,
        id: `${input.operationId}:input:${index}`,
        message: structuredClone(message),
      }));
      operation = await session.appendRecord({
        type: "operation_started",
        id: input.operationId,
        lane,
        sourceLeafId: await session.view(lane).getLeafId(),
        intent: {
          kind: "run",
          originalPrompt: structuredClone(input.messages),
          initialMessages,
          resumeData: {
            [BINDING_EXTENSION]: {
              bindingId: binding.bindingId,
              bindingHash: binding.bindingHash,
              formatVersion: binding.formatVersion,
            },
          },
        },
      });
    } else {
      _assertSameBinding(operation, binding);
      _assertSameRunIntent(operation, input.messages);
    }
    if (operation === undefined) {
      throw new Error(`Operation "${input.operationId}" was not admitted.`);
    }
    if (operation.intent.kind !== "run") {
      throw new Error(`Operation "${input.operationId}" is not a run.`);
    }
    await this._materializeInitialMessages(session, lane, operation);
    return this._snapshot(session, lane);
  }

  /** Executes one current semantic action after stale-UI protection. */
  async step(input: {
    readonly sessionId: string;
    readonly lane?: string;
    readonly expectedActionId: string;
    readonly kind: "model" | "tool";
  }): Promise<PiSessionSnapshot> {
    this._requireOpen();
    const lane = input.lane ?? DEFAULT_LANE;
    const session = await this._session(input.sessionId);
    const before = await this._snapshot(session, lane);
    if (before.nextAction?.id !== input.expectedActionId) {
      // A transport may lose the response after the durable result commits.
      // Reconstructing from Pi identities makes that retry effect-free even
      // after this runtime and the ACP process have both restarted.
      if (
        await this._wasSemanticActionCommitted(
          session,
          lane,
          input.expectedActionId,
          input.kind
        )
      ) {
        return before;
      }
      throw new StaleSemanticActionError(
        input.expectedActionId,
        before.nextAction?.id
      );
    }
    if (before.nextAction.kind !== input.kind) {
      throw new SemanticActionKindError(input.kind, before.nextAction.kind);
    }
    const effect = this._beginEffect(input.sessionId, lane);
    try {
      if (before.nextAction.kind === "tool") {
        await this._executeToolStep(
          session,
          lane,
          before,
          before.nextAction,
          effect.controller.signal
        );
      } else {
        await this._executeModelStep(
          session,
          lane,
          before,
          before.nextAction,
          effect.controller.signal
        );
      }
      return await this._snapshot(session, lane);
    } finally {
      effect.settle();
      this._activeEffects.delete(_laneKey(input.sessionId, lane));
    }
  }

  /** Drives semantic actions until the operation reaches a durable terminal state. */
  async continue(input: {
    readonly sessionId: string;
    readonly lane?: string;
  }): Promise<PiSessionSnapshot> {
    this._requireOpen();
    let snapshot = await this.open(input);
    if (await this._isAbortRecovery(snapshot)) {
      return this.abort(input);
    }
    while (snapshot.nextAction !== undefined) {
      snapshot = await this.step({
        sessionId: input.sessionId,
        ...(input.lane === undefined ? {} : { lane: input.lane }),
        expectedActionId: snapshot.nextAction.id,
        kind: snapshot.nextAction.kind,
      });
      if (await this._isAbortRecovery(snapshot)) {
        return this.abort(input);
      }
    }
    return snapshot;
  }

  /** Persists cancellation intent and outcome; it never resumes paused work. */
  async abort(input: {
    readonly sessionId: string;
    readonly lane?: string;
  }): Promise<PiSessionSnapshot> {
    this._requireOpen();
    const lane = input.lane ?? DEFAULT_LANE;
    const session = await this._session(input.sessionId);
    const operation = await this._operation(session, lane);
    const records = await session.findRecords({ lane, runId: operation.id });
    if (!records.some((record) => record.type === "abort_requested")) {
      await session.appendRecord({
        type: "abort_requested",
        id: `${operation.id}:abort`,
        lane,
        runId: operation.id,
      });
    }
    const active = this._activeEffects.get(_laneKey(input.sessionId, lane));
    active?.controller.abort();
    await active?.settled;
    const stillOpen = await session.findOpenOperations(lane, { limit: 1 });
    if (stillOpen.length === 1) {
      await this._settleInterruptedToolOnAbort(session, lane, operation);
      await session.appendRecord({
        type: "operation_finished",
        id: `${operation.id}:finished`,
        lane,
        runId: operation.id,
        outcome: "aborted",
      });
    }
    return this._snapshot(session, lane);
  }

  /** Returns the exact durable manual-drive subset, not a partial `AgentLane`. */
  harness(input: {
    readonly sessionId: string;
    readonly lane?: string;
    readonly binding?: RuntimeBinding;
  }): DurablePiAgentHarness {
    this._requireOpen();
    return new DurablePiAgentHarness(
      this,
      input.sessionId,
      input.lane ?? DEFAULT_LANE,
      input.binding
    );
  }

  /** Subscribes only to non-durable deltas; Pi Session remains durable truth. */
  subscribe(
    sessionId: string,
    listener: (event: RuntimeEphemeralEvent) => void | Promise<void>
  ): () => void {
    this._requireOpen();
    const listeners = this._listeners.get(sessionId) ?? new Set();
    listeners.add(listener);
    this._listeners.set(sessionId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this._listeners.delete(sessionId);
    };
  }

  /** Reads committed Pi changes immediately without waiting for another write. */
  async readCommitted(input: {
    readonly sessionId: string;
    readonly lane?: string;
    readonly afterSeq?: number;
  }): Promise<PiCommittedChange> {
    this._requireOpen();
    const session = await this._session(input.sessionId);
    const items = await session.getLog(
      input.afterSeq === undefined ? {} : { afterSeq: input.afterSeq }
    );
    const snapshot = await this._snapshot(session, input.lane ?? DEFAULT_LANE);
    // The log and snapshot are separate public Pi reads. Advancing only through
    // returned items prevents a concurrent commit from being skipped.
    const fromCursor = Math.min(snapshot.cursor, input.afterSeq ?? 0);
    const cursor = items.at(-1)?.seq ?? fromCursor;
    return { fromCursor, cursor, items, snapshot };
  }

  /** Projects ordered operation history from Pi records and branch entries. */
  async listOperations(input: {
    readonly sessionId: string;
    readonly lane?: string;
  }): Promise<readonly PiOperationSnapshot[]> {
    this._requireOpen();
    const lane = input.lane ?? DEFAULT_LANE;
    const session = await this._session(input.sessionId);
    const entries = await session
      .view(lane)
      .findEntriesOnBranch({ order: "oldestFirst" });
    const records = await session.findRecords({ lane, order: "oldestFirst" });
    const operations = records.filter(
      (record): record is Extract<LaneRecord, { type: "operation_started" }> =>
        record.type === "operation_started"
    );
    const current = await this._snapshot(session, lane);
    return operations.map((operation, index) => {
      const operationEntries = _entriesForRecordedOperation(
        operation,
        operations[index + 1],
        entries
      ).flatMap((entry) =>
        entry.type === "message" ? [structuredClone(entry)] : []
      );
      const operationLeaf =
        operationEntries.at(-1)?.id ?? operation.sourceLeafId;
      const leafIndex =
        operationLeaf === null
          ? -1
          : entries.findIndex((entry) => entry.id === operationLeaf);
      const conversationEntries = entries
        .slice(0, leafIndex + 1)
        .flatMap((entry) =>
          entry.type === "message" ? [structuredClone(entry)] : []
        );
      const finished = records.find(
        (record) =>
          record.type === "operation_finished" && record.runId === operation.id
      );
      const status =
        finished?.type === "operation_finished"
          ? finished.outcome
          : current.operationId === operation.id
            ? current.status === "completed" ||
              current.status === "failed" ||
              current.status === "aborted"
              ? current.status
              : current.status === "suspended"
                ? "suspended"
                : "paused"
            : "failed";
      return {
        sessionId: input.sessionId,
        lane,
        operationId: operation.id,
        status,
        sourceLeafId: operation.sourceLeafId,
        leafId: operationLeaf,
        conversationEntries,
        messageEntries: operationEntries,
        startedAt: operation.timestamp,
        ...(finished?.type === "operation_finished"
          ? { finishedAt: finished.timestamp }
          : {}),
      };
    });
  }

  /**
   * Observes committed Pi log items from a durable sequence. Notifications are
   * only a delivery mechanism: reconnect always resumes from `Session.getLog`.
   */
  async *watch(input: {
    readonly sessionId: string;
    readonly lane?: string;
    readonly afterSeq?: number;
    readonly signal?: AbortSignal;
    readonly pollIntervalMs?: number;
  }): AsyncGenerator<PiCommittedChange, void, void> {
    this._requireOpen();
    const pollIntervalMs = input.pollIntervalMs ?? 50;
    if (!Number.isFinite(pollIntervalMs) || pollIntervalMs < 0) {
      throw new RangeError("pollIntervalMs must be a non-negative number.");
    }
    const session = await this._session(input.sessionId);
    const lane = input.lane ?? DEFAULT_LANE;
    let cursor = input.afterSeq ?? 0;
    const signals = [this._closeController.signal, input.signal].filter(
      (signal): signal is AbortSignal => signal !== undefined
    );
    while (!signals.some((signal) => signal.aborted)) {
      const fromCursor = cursor;
      const items = await session.getLog({ afterSeq: cursor });
      if (items.length > 0) {
        // Advancing by delivered items prevents a reconnect from skipping a
        // commit that races with the separately reduced snapshot.
        cursor = items.at(-1)!.seq;
        yield {
          fromCursor,
          cursor,
          items,
          snapshot: await this._snapshot(session, lane),
        };
        continue;
      }
      await _waitForPoll(pollIntervalMs, signals);
    }
  }

  /**
   * Stops process-local observation and in-flight effects without recording a
   * user abort. Repository and binding-store ownership stays with the host.
   */
  close(): Promise<void> {
    if (this._closePromise !== undefined) return this._closePromise;
    this._closed = true;
    this._closeController.abort(new Error("Pi Session runtime is closed."));
    const effects = [...this._activeEffects.values()];
    for (const effect of effects)
      effect.controller.abort(this._closeController.signal.reason);
    this._closePromise = Promise.allSettled(
      effects.map((effect) => effect.settled)
    ).then(() => {
      this._activeEffects.clear();
      this._listeners.clear();
      this._sessions.clear();
    });
    return this._closePromise;
  }

  /**
   * Commits one logical assistant result, including durable retry attempts.
   * Recovery reuses the provisioned result id and never calls the provider
   * after that result entry has materialized.
   */
  private async _executeModelStep(
    session: Session,
    lane: string,
    snapshot: PiSessionSnapshot,
    action: Extract<SemanticAction, { kind: "model" }>,
    signal: AbortSignal
  ): Promise<void> {
    const operationId = snapshot.operationId;
    if (operationId === undefined)
      throw new Error("A model step requires an operation.");
    const operation = await this._operation(session, lane);
    // A crash can leave the admitted prompt only partially materialized. The
    // provider must never observe that prefix, so recovery repairs it before
    // releasing the first billable external effect.
    await this._materializeInitialMessages(session, lane, operation);
    const reference = _bindingReference(operation);
    const binding = this._bindings.resolve(reference);
    const records = await session.findRecords({
      lane,
      runId: operationId,
      order: "oldestFirst",
    });
    const priorAttempt = records.filter(_isAssistantAttempt).at(-1);
    const priorResult =
      priorAttempt === undefined
        ? undefined
        : await session.getEntry(priorAttempt.resultEntryId);
    if (
      priorResult?.type === "message" &&
      priorResult.message.role === "assistant" &&
      _toolCalls(priorResult.message).length === 0
    ) {
      await this._finishAssistantOperation(
        session,
        lane,
        operationId,
        priorResult.message
      );
      return;
    }
    const resultEntryId =
      priorAttempt !== undefined && priorResult === undefined
        ? priorAttempt.resultEntryId
        : `${operationId}:assistant:${
            _assistantCount(await session.view(lane).findEntriesOnBranch()) + 1
          }`;
    let attempt = action.attempt;
    let assistant: AssistantMessage;
    while (true) {
      signal.throwIfAborted();
      await session.appendRecord({
        type: "step_attempt",
        id: `${resultEntryId}:attempt:${attempt}`,
        lane,
        runId: operationId,
        step: "assistant",
        attempt,
        resultEntryId,
      });
      signal.throwIfAborted();
      assistant = await this._assistantExecutor.execute({
        operationId,
        binding,
        messages: (
          await session.view(lane).findEntriesOnBranch({ order: "oldestFirst" })
        ).flatMap((entry) =>
          entry.type === "message" ? [structuredClone(entry.message)] : []
        ),
        signal,
        onDelta: (event) => this._publish(snapshot.sessionId, event),
      });
      assistant = _jsonSafe(assistant) as AssistantMessage;
      // Host close and durable user abort both stop process-local materialization.
      // The abort owner decides separately whether to append a terminal record.
      signal.throwIfAborted();
      await session.appendRecord({
        type: "usage",
        id: `${resultEntryId}:usage:${attempt}`,
        lane,
        runId: operationId,
        cause: "assistant",
        entryId: resultEntryId,
        attempt,
        stopReason:
          assistant.stopReason === "pending" ? "error" : assistant.stopReason,
        usage: assistant.usage,
      });
      if (
        signal.aborted ||
        assistant.stopReason !== "error" ||
        attempt >= this._maxModelAttempts
      ) {
        break;
      }
      attempt += 1;
    }
    await session.appendEntry(
      { type: "message", id: resultEntryId, message: assistant },
      lane
    );
    if (_toolCalls(assistant).length === 0) {
      await this._finishAssistantOperation(
        session,
        lane,
        operationId,
        assistant
      );
    }
  }

  /** Commits the terminal outcome, with durable abort intent taking priority. */
  private async _finishAssistantOperation(
    session: Session,
    lane: string,
    operationId: string,
    assistant: AssistantMessage
  ): Promise<void> {
    const aborted = (
      await session.findRecords({ lane, runId: operationId })
    ).some((record) => record.type === "abort_requested");
    await session.appendRecord({
      type: "operation_finished",
      id: `${operationId}:finished`,
      lane,
      runId: operationId,
      outcome:
        aborted || assistant.stopReason === "aborted"
          ? "aborted"
          : assistant.stopReason === "error"
            ? "failed"
            : "completed",
      ...(assistant.errorMessage === undefined
        ? {}
        : { error: { code: "provider", message: assistant.errorMessage } }),
    });
  }

  /**
   * Executes one sequential local tool boundary. `tool_started` is committed
   * before the effect; recovery either reuses its safe identity or synthesizes
   * an interruption without replaying an unsafe effect.
   */
  private async _executeToolStep(
    session: Session,
    lane: string,
    snapshot: PiSessionSnapshot,
    action: Extract<SemanticAction, { kind: "tool" }>,
    signal: AbortSignal
  ): Promise<void> {
    const operationId = snapshot.operationId;
    if (operationId === undefined)
      throw new Error("A tool step requires an operation.");
    const operation = await this._operation(session, lane);
    const binding = this._bindings.resolve(_bindingReference(operation));
    const records = await session.findRecords({
      lane,
      runId: operationId,
      order: "oldestFirst",
    });
    const started = records.find(
      (record): record is Extract<LaneRecord, { type: "tool_started" }> =>
        record.type === "tool_started" &&
        record.assistantEntryId === action.assistantEntryId &&
        record.toolIndex === action.toolIndex
    );
    if (started?.replay === "never") {
      await this._appendInterruptedToolResult(session, lane, started);
      return;
    }

    const tools = await this._resolveTools(binding);
    const prepared = tools.get(action.toolName);
    const bindingTool = binding.tools.find(
      (tool) => tool.name === action.toolName
    );
    if (
      prepared === undefined ||
      prepared.implementationId !== bindingTool?.implementationId
    ) {
      if (started !== undefined) {
        await this._appendInterruptedToolResult(session, lane, started);
        return;
      }
      throw new Error(`Frozen tool "${action.toolName}" is unavailable.`);
    }
    if (started?.replay === "safe" && prepared.definition.replay !== "safe") {
      await this._appendInterruptedToolResult(session, lane, started);
      return;
    }
    if (prepared.definition.approval !== undefined) {
      if (started !== undefined) {
        await this._appendInterruptedToolResult(session, lane, started);
        return;
      }
      await this._appendDirectToolError(
        session,
        lane,
        operationId,
        action,
        `Tool "${action.toolName}" requires approval, which this runtime does not support.`
      );
      return;
    }

    let effectiveArgs: Record<string, unknown>;
    let resultEntryId: string;
    let replay: "never" | "safe";
    if (started === undefined) {
      try {
        const validated = await validateSchemaValue(
          prepared.definition.inputSchema,
          _toolCallArguments(snapshot.messages, action.toolCallId),
          { direction: "input", label: `Input for tool "${action.toolName}"` }
        );
        if (
          typeof validated !== "object" ||
          validated === null ||
          Array.isArray(validated)
        ) {
          throw new Error("validated arguments must be an object");
        }
        effectiveArgs = structuredClone(validated as Record<string, unknown>);
      } catch (error) {
        signal.throwIfAborted();
        await this._appendDirectToolError(
          session,
          lane,
          operationId,
          action,
          error instanceof Error ? error.message : String(error)
        );
        return;
      }
      resultEntryId = `${action.assistantEntryId}:tool:${action.toolIndex}:result`;
      try {
        if (this._toolPolicies.before !== undefined) {
          const policy = await this._toolPolicies.before({
            binding,
            tool: prepared,
            action,
            args: structuredClone(effectiveArgs),
            signal,
          });
          if (policy.blocked === true) {
            await this._appendDirectToolError(
              session,
              lane,
              operationId,
              action,
              policy.message ??
                `Tool "${action.toolName}" was blocked by policy.`
            );
            return;
          }
          if (policy.effectiveArgs !== undefined) {
            const adjusted = await validateSchemaValue(
              prepared.definition.inputSchema,
              policy.effectiveArgs,
              {
                direction: "input",
                label: `Policy-adjusted input for tool "${action.toolName}"`,
              }
            );
            if (
              typeof adjusted !== "object" ||
              adjusted === null ||
              Array.isArray(adjusted)
            ) {
              throw new Error("policy-adjusted arguments must be an object");
            }
            effectiveArgs = structuredClone(
              adjusted as Record<string, unknown>
            );
          }
        }
      } catch (error) {
        signal.throwIfAborted();
        await this._appendDirectToolError(
          session,
          lane,
          operationId,
          action,
          error instanceof Error ? error.message : String(error)
        );
        return;
      }
      signal.throwIfAborted();
      // The immutable binding is authoritative. Current source may weaken a
      // safe declaration, but it may never upgrade a frozen unsafe operation.
      replay = bindingTool.replay;
      await session.appendRecord({
        type: "tool_started",
        id: `${action.assistantEntryId}:tool:${action.toolIndex}:started`,
        lane,
        runId: operationId,
        assistantEntryId: action.assistantEntryId,
        toolIndex: action.toolIndex,
        toolCallId: action.toolCallId,
        toolName: action.toolName,
        effectiveArgs,
        resultEntryId,
        replay,
      });
    } else {
      effectiveArgs = structuredClone(started.effectiveArgs);
      resultEntryId = started.resultEntryId;
      replay = started.replay;
    }

    const idempotencyKey = `${snapshot.sessionId}:${lane}:${operationId}:${action.assistantEntryId}:${action.toolIndex}`;
    let output: unknown;
    let modelOutput: ToolModelOutput;
    let isError: boolean;
    let details: unknown;
    try {
      if (this._createToolContext === undefined) {
        throw new Error("ToolContext factory is unavailable.");
      }
      const context = this._createToolContext({
        execution: {
          sessionId: snapshot.sessionId,
          lane,
          runId: operationId,
          assistantEntryId: action.assistantEntryId,
          toolIndex: action.toolIndex,
          toolCallId: action.toolCallId,
          toolName: action.toolName,
          idempotencyKey,
        },
        signal,
      });
      signal.throwIfAborted();
      output = await _executeTool(prepared.definition, effectiveArgs, context);
      if (prepared.definition.outputSchema !== undefined) {
        output = await validateSchemaValue(
          prepared.definition.outputSchema,
          output,
          {
            direction: "output",
            label: `Output from tool "${action.toolName}"`,
          }
        );
      }
      modelOutput =
        prepared.definition.toModelOutput === undefined
          ? _defaultModelOutput(output)
          : await prepared.definition.toModelOutput(output);
      isError = prepared.isErrorResult?.(output) ?? false;
      details = { output: _jsonSafe(output), replay, idempotencyKey };
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof DurableEffectCrash) throw error;
      modelOutput = {
        type: "text",
        value: error instanceof Error ? error.message : String(error),
      };
      details = { replay, idempotencyKey };
      isError = true;
    }

    let usage: Usage | undefined;
    try {
      if (this._toolPolicies.after !== undefined) {
        const finalized = await this._toolPolicies.after({
          binding,
          tool: prepared,
          action,
          output,
          modelOutput,
          isError,
          signal,
        });
        modelOutput = finalized.modelOutput ?? modelOutput;
        details = finalized.details ?? details;
        isError = finalized.isError ?? isError;
        usage = finalized.usage;
      }
    } catch (error) {
      signal.throwIfAborted();
      modelOutput = {
        type: "text",
        value: error instanceof Error ? error.message : String(error),
      };
      details = { replay, idempotencyKey, afterPolicyFailed: true };
      isError = true;
    }
    signal.throwIfAborted();
    if (usage !== undefined)
      await this._appendToolUsage(
        session,
        lane,
        operationId,
        resultEntryId,
        action.toolCallId,
        usage
      );
    await this._appendToolResult(session, lane, resultEntryId, {
      role: "toolResult",
      toolCallId: action.toolCallId,
      toolName: action.toolName,
      content: _toolModelContent(modelOutput),
      details,
      isError,
      timestamp: Date.now(),
    });
  }

  /** Materializes a pre-admission tool error without writing `tool_started`. */
  private async _appendDirectToolError(
    session: Session,
    lane: string,
    operationId: string,
    action: Extract<SemanticAction, { kind: "tool" }>,
    message: string
  ): Promise<void> {
    await this._appendToolResult(
      session,
      lane,
      `${action.assistantEntryId}:tool:${action.toolIndex}:result`,
      {
        role: "toolResult",
        toolCallId: action.toolCallId,
        toolName: action.toolName,
        content: [{ type: "text", text: message }],
        details: { operationId },
        isError: true,
        timestamp: Date.now(),
      }
    );
  }

  /** Settles an admitted but unsafe/now-unresolvable tool without replaying it. */
  private async _appendInterruptedToolResult(
    session: Session,
    lane: string,
    started: Extract<LaneRecord, { type: "tool_started" }>
  ): Promise<void> {
    await this._appendToolResult(session, lane, started.resultEntryId, {
      role: "toolResult",
      toolCallId: started.toolCallId,
      toolName: started.toolName,
      content: [
        {
          type: "text",
          text: "Tool execution was interrupted after its side effect may have started and was not replayed.",
        },
      ],
      details: { interrupted: true, replay: started.replay },
      isError: true,
      timestamp: Date.now(),
    });
  }

  /** Idempotently materializes the one provisioned result for a tool call. */
  private async _appendToolResult(
    session: Session,
    lane: string,
    resultEntryId: string,
    message: Extract<AgentMessage, { role: "toolResult" }>
  ): Promise<void> {
    const existing = await session.getEntry(resultEntryId);
    if (existing !== undefined) {
      if (
        existing.type !== "message" ||
        existing.message.role !== "toolResult" ||
        !_sameToolResult(existing.message, message)
      ) {
        throw new DurableSessionCorruptionError(
          `Tool result "${resultEntryId}" was materialized differently.`
        );
      }
      return;
    }
    await session.appendEntry(
      { type: "message", id: resultEntryId, message },
      lane
    );
  }

  /**
   * Commits optional tool accounting idempotently across the usage/result
   * crash window. An existing record is authoritative; safe replay may execute
   * the effect again, but must not duplicate or replace already-booked usage.
   */
  private async _appendToolUsage(
    session: Session,
    lane: string,
    operationId: string,
    resultEntryId: string,
    toolCallId: string,
    usage: Usage
  ): Promise<void> {
    const id = `${resultEntryId}:usage`;
    const existing = (
      await session.findRecords({ lane, runId: operationId })
    ).find((record) => record.id === id);
    if (existing !== undefined) {
      if (
        existing.type !== "usage" ||
        existing.cause !== "tool" ||
        existing.entryId !== resultEntryId ||
        existing.toolCallId !== toolCallId
      ) {
        throw new DurableSessionCorruptionError(
          `Tool usage record "${id}" has conflicting identity.`
        );
      }
      return;
    }
    await session.appendRecord({
      type: "usage",
      id,
      lane,
      runId: operationId,
      cause: "tool",
      entryId: resultEntryId,
      toolCallId,
      usage,
    });
  }

  /**
   * Purely reduces committed Pi entries/records into the debugger snapshot.
   * Missing bindings/identities suspend; invalid durable prefixes throw a
   * permanent corruption fault instead of guessing a continuation.
   */
  private async _snapshot(
    session: Session,
    lane: string
  ): Promise<PiSessionSnapshot> {
    const cursor = (await session.getLog()).at(-1)?.seq ?? 0;
    const view = session.view(lane);
    const entries = await view.findEntriesOnBranch({ order: "oldestFirst" });
    const messages = entries.flatMap((entry) =>
      entry.type === "message" ? [structuredClone(entry.message)] : []
    );
    const messageEntries = entries.flatMap((entry) =>
      entry.type === "message" ? [structuredClone(entry)] : []
    );
    const open = await session.findOpenOperations(lane, { limit: 2 });
    if (open.length > 1) {
      throw new Error(`Lane "${lane}" has multiple open operations.`);
    }
    const operation = open[0];
    if (operation === undefined) {
      const finished = (
        await session.findRecords({
          lane,
          type: "operation_finished",
          limit: 1,
        })
      )[0];
      return {
        cursor,
        sessionId: (await session.getMetadata()).id,
        lane,
        ...(finished === undefined ? {} : { operationId: finished.runId }),
        status:
          finished === undefined
            ? "idle"
            : finished.outcome === "completed"
              ? "completed"
              : finished.outcome === "aborted"
                ? "aborted"
                : "failed",
        messageEntries,
        messages,
        leafId: await view.getLeafId(),
      };
    }
    let binding: RuntimeBinding;
    try {
      binding = this._bindings.resolve(_bindingReference(operation));
    } catch (error) {
      if (!(error instanceof RuntimeBindingResolutionError)) throw error;
      return {
        cursor,
        sessionId: (await session.getMetadata()).id,
        lane,
        operationId: operation.id,
        status: "suspended",
        messageEntries,
        messages,
        leafId: await view.getLeafId(),
        suspension: {
          code:
            error.code === "missing"
              ? "missing_binding"
              : error.code === "hash_mismatch"
                ? "binding_hash_mismatch"
                : "binding_format_mismatch",
          message: error.message,
        },
      };
    }
    const records = await session.findRecords({
      lane,
      runId: operation.id,
      order: "oldestFirst",
    });
    _validateOperationPrefix(operation, entries, records);
    const pendingTool = _pendingTool(operation, entries);
    if (pendingTool !== undefined) {
      const started = records.find(
        (record) =>
          record.type === "tool_started" &&
          record.assistantEntryId === pendingTool.assistantEntry.id &&
          record.toolIndex === pendingTool.toolIndex
      );
      if (started === undefined) {
        const frozen = binding.tools.find(
          (tool) => tool.name === pendingTool.toolCall.name
        );
        const current = (await this._resolveTools(binding)).get(
          pendingTool.toolCall.name
        );
        if (frozen === undefined || current === undefined) {
          return {
            cursor,
            sessionId: (await session.getMetadata()).id,
            lane,
            operationId: operation.id,
            status: "suspended",
            messageEntries,
            messages,
            leafId: await view.getLeafId(),
            suspension: {
              code: "missing_tool_identity",
              message: `Frozen tool "${pendingTool.toolCall.name}" is unavailable.`,
            },
          };
        }
        if (current.implementationId !== frozen.implementationId) {
          return {
            cursor,
            sessionId: (await session.getMetadata()).id,
            lane,
            operationId: operation.id,
            status: "suspended",
            messageEntries,
            messages,
            leafId: await view.getLeafId(),
            suspension: {
              code: "tool_identity_mismatch",
              message: `Frozen tool "${pendingTool.toolCall.name}" resolved to another implementation.`,
            },
          };
        }
      }
    }
    const nextAction = _nextAction(operation, entries, records);
    if (
      nextAction?.kind === "model" &&
      this._assistantExecutor.checkAvailability !== undefined
    ) {
      const availability =
        await this._assistantExecutor.checkAvailability(binding);
      if (!availability.available) {
        return {
          cursor,
          sessionId: (await session.getMetadata()).id,
          lane,
          operationId: operation.id,
          status: "suspended",
          messageEntries,
          messages,
          leafId: await view.getLeafId(),
          suspension: {
            code: "missing_model_identity",
            message: availability.message,
          },
        };
      }
    }
    return {
      cursor,
      sessionId: (await session.getMetadata()).id,
      lane,
      operationId: operation.id,
      status: "paused",
      messageEntries,
      messages,
      leafId: await view.getLeafId(),
      nextAction,
    };
  }

  /**
   * Repairs the crash window between operation admission and prompt entries.
   * Existing entries must equal their provisioned content; mismatches are
   * durable corruption and are never overwritten.
   */
  private async _materializeInitialMessages(
    session: Session,
    lane: string,
    operation: OperationStartedRecord
  ): Promise<void> {
    if (operation.intent.kind !== "run") return;
    for (const provisioned of operation.intent.initialMessages) {
      const existing = await session.getEntry(provisioned.id);
      if (existing === undefined) {
        await session.appendEntry<Entry>(provisioned, lane);
        continue;
      }
      if (!_matchesProvisionedEntry(existing, provisioned)) {
        throw new DurableSessionCorruptionError(
          `Entry "${provisioned.id}" does not match its provisioned run input.`
        );
      }
    }
  }

  /** Registers the one abortable effect allowed for a sequential debug lane. */
  private _beginEffect(sessionId: string, lane: string): ActiveLaneEffect {
    // This check and registration are synchronous, so close either rejects the
    // new effect or observes and aborts it in `_activeEffects`.
    this._requireOpen();
    const key = _laneKey(sessionId, lane);
    if (this._activeEffects.has(key)) {
      throw new Error(`Lane "${lane}" already has an active effect.`);
    }
    const controller = new AbortController();
    let settle!: () => void;
    const settled = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const effect = { controller, settled, settle };
    this._activeEffects.set(key, effect);
    return effect;
  }

  /** Waits until the lane has no provider/tool effect in flight. */
  async waitForIdle(
    sessionId: string,
    lane: string = DEFAULT_LANE
  ): Promise<void> {
    this._requireOpen();
    await this._activeEffects.get(_laneKey(sessionId, lane))?.settled;
  }

  /** Runs host work only after the current lane effect has durably settled. */
  async runWhenIdle(
    sessionId: string,
    lane: string,
    callback: () => void | Promise<void>
  ): Promise<void> {
    this._requireOpen();
    await this.waitForIdle(sessionId, lane);
    await callback();
  }

  /** Returns the Pi tree view for the already-open durable Session. */
  sessionTree(sessionId: string, lane: string = DEFAULT_LANE): SessionTree {
    this._requireOpen();
    const session = this._sessions.get(sessionId);
    if (session === undefined) {
      throw new Error(
        `Session "${sessionId}" must be opened before creating its Harness.`
      );
    }
    return session.view(lane);
  }

  /** Resolves the single open operation or rejects invalid lane state. */
  private async _operation(
    session: Session,
    lane: string
  ): Promise<OperationStartedRecord> {
    const operations = await session.findOpenOperations(lane, { limit: 2 });
    if (operations.length !== 1) {
      throw new Error(
        `Lane "${lane}" does not have exactly one open operation.`
      );
    }
    return operations[0]!;
  }

  /**
   * Materializes the required interruption result for an admitted tool whose
   * process/effect did not settle before abort. It never runs policies or code.
   */
  private async _settleInterruptedToolOnAbort(
    session: Session,
    lane: string,
    operation: OperationStartedRecord
  ): Promise<void> {
    const entries = await session
      .view(lane)
      .findEntriesOnBranch({ order: "oldestFirst" });
    const pending = _pendingTool(operation, entries);
    if (pending === undefined) return;
    const started = (
      await session.findRecords({
        lane,
        runId: operation.id,
        order: "oldestFirst",
      })
    ).find(
      (record): record is Extract<LaneRecord, { type: "tool_started" }> =>
        record.type === "tool_started" &&
        record.assistantEntryId === pending.assistantEntry.id &&
        record.toolIndex === pending.toolIndex
    );
    if (started !== undefined) {
      await this._appendInterruptedToolResult(session, lane, started);
    }
  }

  /** Detects a durable abort prefix that must finish instead of resuming work. */
  private async _isAbortRecovery(
    snapshot: PiSessionSnapshot
  ): Promise<boolean> {
    if (snapshot.operationId === undefined || snapshot.status !== "paused") {
      return false;
    }
    const session = await this._session(snapshot.sessionId);
    return (
      await session.findRecords({
        lane: snapshot.lane,
        runId: snapshot.operationId,
      })
    ).some((record) => record.type === "abort_requested");
  }

  /**
   * Proves a lost-response retry from committed Pi entries only. Unknown or
   * merely-started actions stay stale so this check can never admit an effect.
   */
  private async _wasSemanticActionCommitted(
    session: Session,
    lane: string,
    expectedActionId: string,
    kind: "model" | "tool"
  ): Promise<boolean> {
    const entries = await session
      .view(lane)
      .findEntriesOnBranch({ order: "oldestFirst" });
    const records = await session.findRecords({ lane, order: "oldestFirst" });
    const operations = records.filter(
      (record): record is Extract<LaneRecord, { type: "operation_started" }> =>
        record.type === "operation_started"
    );
    for (
      let operationIndex = 0;
      operationIndex < operations.length;
      operationIndex += 1
    ) {
      const operation = operations[operationIndex]!;
      const operationEntries = _entriesForRecordedOperation(
        operation,
        operations[operationIndex + 1],
        entries
      );
      const assistants = operationEntries.filter(
        (
          entry
        ): entry is Extract<Entry, { type: "message" }> & {
          message: AssistantMessage;
        } => entry.type === "message" && entry.message.role === "assistant"
      );
      if (kind === "model") {
        for (let turn = 0; turn < assistants.length; turn += 1) {
          const assistant = assistants[turn]!;
          const attempts = records
            .filter(_isAssistantAttempt)
            .filter(
              (record) =>
                record.runId === operation.id &&
                record.resultEntryId === assistant.id
            );
          if (
            attempts.some(
              (attempt) =>
                _modelActionId(operation.id, turn + 1, attempt.attempt) ===
                expectedActionId
            )
          ) {
            return true;
          }
        }
        continue;
      }
      for (const assistant of assistants) {
        const calls = _toolCalls(assistant.message);
        for (let toolIndex = 0; toolIndex < calls.length; toolIndex += 1) {
          const resultEntryId = `${assistant.id}:tool:${toolIndex}:result`;
          if (
            _toolActionId(operation.id, assistant.id, toolIndex) ===
              expectedActionId &&
            operationEntries.some((entry) => entry.id === resultEntryId)
          ) {
            return true;
          }
        }
      }
    }
    return false;
  }

  /** Opens and caches one fenced Pi Session writer for this process runtime. */
  private async _session(sessionId: string): Promise<Session> {
    const active = this._sessions.get(sessionId);
    if (active !== undefined) return active;
    const metadata = (await this._repository.list()).find(
      (candidate: SessionMetadata) => candidate.id === sessionId
    );
    if (metadata === undefined)
      throw new Error(`Session "${sessionId}" was not found.`);
    const session = await this._repository.open(metadata);
    this._sessions.set(sessionId, session);
    return session;
  }

  /** Delivers non-durable deltas only after callers opt into observation. */
  private async _publish(
    sessionId: string,
    event: RuntimeEphemeralEvent
  ): Promise<void> {
    const listeners = this._listeners.get(sessionId);
    if (listeners === undefined) return;
    // Ephemeral observers are not part of the durable execution protocol; a
    // disconnected UI must not turn a provider result into a retryable fault.
    await Promise.allSettled(
      [...listeners].map((listener) =>
        Promise.resolve().then(() => listener(event))
      )
    );
  }

  /** Rejects new work after lifecycle shutdown while allowing started work to unwind. */
  private _requireOpen(): void {
    if (this._closed) throw new Error("Pi Session runtime is closed.");
  }
}

/** Manual-drive Harness bound to one durable Pi Session lane. */
export class DurablePiAgentHarness {
  readonly name: string;
  readonly session: SessionTree;

  constructor(
    private readonly _runtime: StudioPiSessionRuntime,
    readonly sessionId: string,
    lane: string = DEFAULT_LANE,
    private readonly _binding?: RuntimeBinding
  ) {
    this.name = lane;
    this.session = _runtime.sessionTree(sessionId, lane);
  }

  /** Returns the current durable lane leaf without causing recovery work. */
  async getLeafId(): Promise<string | null> {
    return (
      await this._runtime.open({ sessionId: this.sessionId, lane: this.name })
    ).leafId;
  }

  /** Returns the stable next semantic action without releasing it. */
  async peekAction(): Promise<SemanticAction | undefined> {
    return (
      await this._runtime.open({ sessionId: this.sessionId, lane: this.name })
    ).nextAction;
  }

  /** Admits and automatically drives one prompt using the Harness binding. */
  async prompt(
    input: string | AgentMessage | AgentMessage[]
  ): Promise<PiSessionSnapshot> {
    if (this._binding === undefined) {
      throw new Error("Harness prompt requires a frozen runtime binding.");
    }
    const messages = Array.isArray(input)
      ? input
      : typeof input === "string"
        ? [{ role: "user" as const, content: input, timestamp: Date.now() }]
        : [input];
    await this._runtime.start({
      operationId: `run:${crypto.randomUUID()}`,
      sessionId: this.sessionId,
      lane: this.name,
      messages,
      binding: this._binding,
    });
    return this.runToCompletion();
  }

  /** Resumes the durable action exposed by recovery for this lane. */
  resume(): Promise<PiSessionSnapshot> {
    return this.runToCompletion();
  }

  /** Resolves after the current provider/tool effect and its commits settle. */
  waitForIdle(): Promise<void> {
    return this._runtime.waitForIdle(this.sessionId, this.name);
  }

  /** Runs a callback after the lane becomes idle. */
  runWhenIdle(callback: () => void | Promise<void>): Promise<void> {
    return this._runtime.runWhenIdle(this.sessionId, this.name, callback);
  }

  /** Releases exactly the action observed at the start of this call. */
  async executeAction(): Promise<PiSessionSnapshot> {
    const snapshot = await this._runtime.open({
      sessionId: this.sessionId,
      lane: this.name,
    });
    if (snapshot.nextAction === undefined) return snapshot;
    return this._runtime.step({
      sessionId: this.sessionId,
      lane: this.name,
      expectedActionId: snapshot.nextAction.id,
      kind: snapshot.nextAction.kind,
    });
  }

  /** Runs the same semantic actions without parking between boundaries. */
  runToCompletion(): Promise<PiSessionSnapshot> {
    return this._runtime.continue({
      sessionId: this.sessionId,
      lane: this.name,
    });
  }

  /** Persists a durable abort request and terminal outcome. */
  abort(): Promise<PiSessionSnapshot> {
    return this._runtime.abort({ sessionId: this.sessionId, lane: this.name });
  }
}

/** Resolves after the polling interval or immediately when observation stops. */
function _waitForPoll(
  durationMs: number,
  signals: readonly AbortSignal[]
): Promise<void> {
  if (durationMs === 0 || signals.some((signal) => signal.aborted)) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const timer = setTimeout(finish, durationMs);
    for (const signal of signals) {
      signal.addEventListener("abort", finish, { once: true });
    }

    function finish(): void {
      clearTimeout(timer);
      for (const signal of signals) {
        signal.removeEventListener("abort", finish);
      }
      resolve();
    }
  });
}

/**
 * Derives the one semantic boundary that may execute next from durable state.
 * Tool calls take precedence over another model turn, while an abort request
 * suppresses all effects so recovery cannot accidentally resume cancelled work.
 */
function _nextAction(
  operation: OperationStartedRecord,
  entries: readonly Entry[],
  records: readonly LaneRecord[]
): SemanticAction | undefined {
  if (records.some((record) => record.type === "abort_requested")) {
    return undefined;
  }
  const pendingTool = _pendingTool(operation, entries);
  if (pendingTool !== undefined) {
    return {
      id: _toolActionId(
        operation.id,
        pendingTool.assistantEntry.id,
        pendingTool.toolIndex
      ),
      kind: "tool",
      assistantEntryId: pendingTool.assistantEntry.id,
      toolIndex: pendingTool.toolIndex,
      toolCallId: pendingTool.toolCall.id,
      toolName: pendingTool.toolCall.name,
    };
  }
  const attempts = records.filter(_isAssistantAttempt);
  const lastAttempt = attempts.at(-1);
  const lastAttemptSettled =
    lastAttempt === undefined ||
    entries.some((entry) => entry.id === lastAttempt.resultEntryId);
  const attempt = lastAttemptSettled ? 1 : lastAttempt.attempt + 1;
  const turn = _assistantCount(_entriesForOperation(operation, entries)) + 1;
  return {
    id: _modelActionId(operation.id, turn, attempt),
    kind: "model",
    attempt,
  };
}

/** Gives every provider turn/retry a stable identity within one operation. */
function _modelActionId(
  operationId: string,
  turn: number,
  attempt: number
): string {
  return `${operationId}:model:${turn}:${attempt}`;
}

/** Gives every sequential tool call a stable identity within one operation. */
function _toolActionId(
  operationId: string,
  assistantEntryId: string,
  toolIndex: number
): string {
  return `${operationId}:tool:${assistantEntryId}:${toolIndex}`;
}

/**
 * Finds the first unresolved call on the latest assistant message.
 * Only results after that message count, preventing an older call with a reused
 * provider id from satisfying the current assistant turn.
 */
function _pendingTool(
  operation: OperationStartedRecord,
  entries: readonly Entry[]
):
  | {
      assistantEntry: Extract<Entry, { type: "message" }>;
      toolIndex: number;
      toolCall: ReturnType<typeof _toolCalls>[number];
    }
  | undefined {
  const operationEntries = _entriesForOperation(operation, entries);
  const assistantEntry = operationEntries.findLast(
    (
      entry
    ): entry is Extract<Entry, { type: "message" }> & {
      message: AssistantMessage;
    } => entry.type === "message" && entry.message.role === "assistant"
  );
  if (assistantEntry === undefined) return undefined;
  const results = new Set(
    operationEntries.flatMap((entry) =>
      entry.seq > assistantEntry.seq &&
      entry.type === "message" &&
      entry.message.role === "toolResult"
        ? [entry.message.toolCallId]
        : []
    )
  );
  const toolCalls = _toolCalls(assistantEntry.message);
  const toolIndex = toolCalls.findIndex((call) => !results.has(call.id));
  if (toolIndex < 0) return undefined;
  return { assistantEntry, toolIndex, toolCall: toolCalls[toolIndex]! };
}

/**
 * Returns the branch suffix owned by one operation. `sourceLeafId` is the
 * immutable boundary captured at admission; a missing boundary means the
 * supplied branch cannot safely describe this operation.
 */
function _entriesForOperation(
  operation: OperationStartedRecord,
  entries: readonly Entry[]
): readonly Entry[] {
  if (operation.sourceLeafId === null) return entries;
  const sourceIndex = entries.findIndex(
    (entry) => entry.id === operation.sourceLeafId
  );
  if (sourceIndex < 0) {
    throw new DurableSessionCorruptionError(
      `Operation "${operation.id}" source leaf "${operation.sourceLeafId}" is not on the active branch.`
    );
  }
  return entries.slice(sourceIndex + 1);
}

/** Bounds a historical operation at the next admission's immutable source. */
function _entriesForRecordedOperation(
  operation: OperationStartedRecord,
  nextOperation: OperationStartedRecord | undefined,
  entries: readonly Entry[]
): readonly Entry[] {
  const suffix = _entriesForOperation(operation, entries);
  if (nextOperation?.sourceLeafId === null || nextOperation === undefined) {
    return suffix;
  }
  const lastOwnedIndex = suffix.findIndex(
    (entry) => entry.id === nextOperation.sourceLeafId
  );
  if (lastOwnedIndex < 0) {
    throw new DurableSessionCorruptionError(
      `Operation "${nextOperation.id}" source leaf "${nextOperation.sourceLeafId}" is not on the active branch.`
    );
  }
  return suffix.slice(0, lastOwnedIndex + 1);
}

/** Narrows one assistant message to its ordered local tool-call parts. */
function _toolCalls(message: AssistantMessage) {
  return message.content.filter(
    (
      content
    ): content is Extract<
      AssistantMessage["content"][number],
      { type: "toolCall" }
    > => content.type === "toolCall"
  );
}

/** Counts committed assistant turns when provisioning a collision-free result id. */
function _assistantCount(entries: readonly Entry[]): number {
  return entries.filter(
    (entry) => entry.type === "message" && entry.message.role === "assistant"
  ).length;
}

/** Narrows recovery records to provider attempts used by model-step sequencing. */
function _isAssistantAttempt(record: LaneRecord): record is Extract<
  LaneRecord,
  { type: "step_attempt" }
> & {
  step: "assistant";
} {
  return record.type === "step_attempt" && record.step === "assistant";
}

/**
 * Reads the immutable LLM Space binding identity embedded in Pi resume data.
 * Malformed or absent data becomes an invalid empty reference and is rejected
 * by normal binding resolution rather than being guessed from current config.
 */
function _bindingReference(
  operation: OperationStartedRecord
): RuntimeBindingReference {
  if (operation.intent.kind !== "run")
    throw new Error("Operation is not a run.");
  const value = operation.intent.resumeData?.[BINDING_EXTENSION];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { bindingId: "", bindingHash: "", formatVersion: 0 };
  }
  return {
    bindingId: typeof value.bindingId === "string" ? value.bindingId : "",
    bindingHash: typeof value.bindingHash === "string" ? value.bindingHash : "",
    formatVersion:
      typeof value.formatVersion === "number" ? value.formatVersion : 0,
  };
}

/** Ensures an idempotent operation id cannot be reused with a different frozen binding. */
function _assertSameBinding(
  operation: OperationStartedRecord,
  binding: RuntimeBindingReference
): void {
  const existing = _bindingReference(operation);
  if (
    existing.bindingId !== binding.bindingId ||
    existing.bindingHash !== binding.bindingHash ||
    existing.formatVersion !== binding.formatVersion
  ) {
    throw new Error(
      `Operation "${operation.id}" has conflicting runtime binding.`
    );
  }
}

/** Rejects an idempotency-key collision before any duplicate Session writes. */
function _assertSameRunIntent(
  operation: OperationStartedRecord,
  messages: readonly AgentMessage[]
): void {
  if (
    operation.intent.kind !== "run" ||
    _canonicalJson(operation.intent.originalPrompt) !== _canonicalJson(messages)
  ) {
    throw new OperationAdmissionConflictError(operation.id);
  }
}

/**
 * Validates the record/entry relationships needed to resume effects safely.
 * It accepts incomplete durable prefixes, but never guesses through identity
 * gaps, reordered attempts, or mismatched provisioned results.
 */
function _validateOperationPrefix(
  operation: OperationStartedRecord,
  entries: readonly Entry[],
  records: readonly LaneRecord[]
): void {
  for (let index = 1; index < records.length; index += 1) {
    if (records[index]!.seq <= records[index - 1]!.seq) {
      throw new DurableSessionCorruptionError(
        `Operation "${operation.id}" records are not strictly ordered.`
      );
    }
  }
  if (operation.intent.kind !== "run") {
    throw new DurableSessionCorruptionError(
      `Operation "${operation.id}" is not a supported run.`
    );
  }
  const operationEntries = _entriesForOperation(operation, entries);
  _validateToolResults(operation, operationEntries);
  for (const provisioned of operation.intent.initialMessages) {
    const existing = operationEntries.find(
      (entry) => entry.id === provisioned.id
    );
    if (
      existing !== undefined &&
      !_matchesProvisionedEntry(existing, provisioned)
    ) {
      throw new DurableSessionCorruptionError(
        `Provisioned input "${provisioned.id}" was materialized differently.`
      );
    }
  }

  const attemptsByResult = new Map<string, number>();
  const startedTools = new Set<string>();
  let abortRequests = 0;
  let finishedSeq: number | undefined;
  for (const record of records) {
    if (finishedSeq !== undefined) {
      throw new DurableSessionCorruptionError(
        `Operation "${operation.id}" has a record after operation_finished.`
      );
    }
    if (record.type === "operation_finished") {
      finishedSeq = record.seq;
      continue;
    }
    if (record.type === "operation_started") {
      if (record.id !== operation.id || record.seq !== operation.seq) {
        throw new DurableSessionCorruptionError(
          `Operation "${operation.id}" contains another operation start.`
        );
      }
      continue;
    }
    if (record.type === "step_attempt") {
      if (record.step !== "assistant") {
        throw new DurableSessionCorruptionError(
          `Operation "${operation.id}" contains an unsupported step attempt.`
        );
      }
      const expected = (attemptsByResult.get(record.resultEntryId) ?? 0) + 1;
      if (record.attempt !== expected) {
        throw new DurableSessionCorruptionError(
          `Assistant result "${record.resultEntryId}" has attempt ${record.attempt}; expected ${expected}.`
        );
      }
      const result = operationEntries.find(
        (entry) => entry.id === record.resultEntryId
      );
      if (
        result !== undefined &&
        (result.type !== "message" || result.message.role !== "assistant")
      ) {
        throw new DurableSessionCorruptionError(
          `Assistant result "${record.resultEntryId}" has the wrong entry type.`
        );
      }
      attemptsByResult.set(record.resultEntryId, record.attempt);
      continue;
    }
    if (record.type === "tool_started") {
      const identity = `${record.assistantEntryId}:${record.toolIndex}`;
      if (startedTools.has(identity)) {
        throw new DurableSessionCorruptionError(
          `Tool invocation "${identity}" has duplicate tool_started records.`
        );
      }
      const assistant = operationEntries.find(
        (entry) => entry.id === record.assistantEntryId
      );
      const call =
        assistant?.type === "message" && assistant.message.role === "assistant"
          ? _toolCalls(assistant.message)[record.toolIndex]
          : undefined;
      if (
        call?.id !== record.toolCallId ||
        call.name !== record.toolName ||
        record.resultEntryId !==
          `${record.assistantEntryId}:tool:${record.toolIndex}:result`
      ) {
        throw new DurableSessionCorruptionError(
          `Tool invocation "${identity}" does not match its assistant call.`
        );
      }
      const result = operationEntries.find(
        (entry) => entry.id === record.resultEntryId
      );
      if (
        result !== undefined &&
        (result.type !== "message" ||
          result.message.role !== "toolResult" ||
          result.message.toolCallId !== record.toolCallId ||
          result.message.toolName !== record.toolName)
      ) {
        throw new DurableSessionCorruptionError(
          `Tool result "${record.resultEntryId}" does not match its provisioned invocation.`
        );
      }
      startedTools.add(identity);
      continue;
    }
    if (record.type === "usage") {
      if (
        record.cause === "assistant" &&
        !records.some(
          (candidate) =>
            candidate.type === "step_attempt" &&
            candidate.step === "assistant" &&
            candidate.resultEntryId === record.entryId &&
            candidate.attempt === record.attempt
        )
      ) {
        throw new DurableSessionCorruptionError(
          `Assistant usage for "${record.entryId}" has no matching attempt.`
        );
      }
      if (
        record.cause === "tool" &&
        !records.some(
          (candidate) =>
            candidate.type === "tool_started" &&
            candidate.resultEntryId === record.entryId &&
            candidate.toolCallId === record.toolCallId
        )
      ) {
        throw new DurableSessionCorruptionError(
          `Tool usage for "${record.entryId}" has no matching tool_started.`
        );
      }
      continue;
    }
    if (record.type === "abort_requested") {
      abortRequests += 1;
      if (abortRequests > 1) {
        throw new DurableSessionCorruptionError(
          `Operation "${operation.id}" has duplicate abort requests.`
        );
      }
      continue;
    }
    throw new DurableSessionCorruptionError(
      `Operation "${operation.id}" contains unsupported record "${record.type}".`
    );
  }
}

/**
 * Validates every operation-owned tool result against the preceding assistant
 * call that provisioned its deterministic id. This catches wrong-role/name/id
 * materialization before the reducer can mistake it for a settled tool.
 */
function _validateToolResults(
  operation: OperationStartedRecord,
  entries: readonly Entry[]
): void {
  const settled = new Set<string>();
  for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
    const entry = entries[entryIndex]!;
    if (entry.type !== "message" || entry.message.role !== "toolResult") {
      continue;
    }
    const result = entry.message;
    const assistant = entries.slice(0, entryIndex).findLast(
      (
        candidate
      ): candidate is Extract<Entry, { type: "message" }> & {
        message: AssistantMessage;
      } =>
        candidate.type === "message" &&
        candidate.message.role === "assistant" &&
        _toolCalls(candidate.message).some(
          (call) => call.id === result.toolCallId
        )
    );
    const toolIndex =
      assistant === undefined
        ? -1
        : _toolCalls(assistant.message).findIndex(
            (call) => call.id === result.toolCallId
          );
    const call =
      assistant === undefined
        ? undefined
        : _toolCalls(assistant.message)[toolIndex];
    const identity =
      assistant === undefined ? "" : `${assistant.id}:${toolIndex}`;
    if (
      assistant === undefined ||
      call?.name !== result.toolName ||
      entry.id !== `${assistant.id}:tool:${toolIndex}:result` ||
      settled.has(identity)
    ) {
      throw new DurableSessionCorruptionError(
        `Operation "${operation.id}" contains an invalid tool result "${entry.id}".`
      );
    }
    settled.add(identity);
  }
}

/** Compares provisioned content while ignoring storage-assigned metadata. */
function _matchesProvisionedEntry(
  existing: Entry,
  provisioned: ProvisionedEntry
): boolean {
  const content = Object.fromEntries(
    Object.entries(existing).filter(
      ([key]) => key !== "parentId" && key !== "seq" && key !== "timestamp"
    )
  );
  return _canonicalJson(content) === _canonicalJson(provisioned);
}

/** Produces stable JSON for idempotency and corruption comparisons. */
function _canonicalJson(value: unknown): string {
  const normalized = _sortJson(value);
  return JSON.stringify(normalized) ?? "undefined";
}

/** Recursively sorts object keys and drops undefined fields to match JSON serialization semantics. */
function _sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(_sortJson);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, _sortJson(entry)])
  );
}

/** Builds a collision-free process-local key for one Session lane's active effect. */
function _laneKey(sessionId: string, lane: string): string {
  return `${sessionId}\u0000${lane}`;
}

/**
 * Resolves a frozen tool call's original arguments from the canonical Pi transcript.
 * The reverse scan prefers the newest assistant turn; absence is corruption and
 * must fail before executing a side effect with invented input.
 */
function _toolCallArguments(
  messages: readonly AgentMessage[],
  toolCallId: string
): Record<string, unknown> {
  for (
    let messageIndex = messages.length - 1;
    messageIndex >= 0;
    messageIndex -= 1
  ) {
    const message = messages[messageIndex];
    if (message?.role !== "assistant") continue;
    const call = _toolCalls(message).find(
      (candidate) => candidate.id === toolCallId
    );
    if (call !== undefined) return structuredClone(call.arguments);
  }
  throw new Error(`Tool call "${toolCallId}" was not found in the transcript.`);
}

/** Executes either a plain tool result or drains a streaming tool to its final value. */
async function _executeTool(
  definition: ToolDefinition,
  input: Record<string, unknown>,
  context: ToolContext
): Promise<unknown> {
  const execution = definition.execute(input, context);
  if (!_isAsyncIterable(execution)) return execution;
  let value: unknown;
  for await (const part of execution) value = part;
  return value;
}

/** Detects authored streaming tools without consuming their iterator. */
function _isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    Symbol.asyncIterator in value &&
    typeof value[Symbol.asyncIterator] === "function"
  );
}

/** Preserves strings as text and exposes all other ordinary values as JSON. */
function _defaultModelOutput(value: unknown): ToolModelOutput {
  return typeof value === "string"
    ? { type: "text", value }
    : { type: "json", value };
}

/** Converts the author-facing model output union into Pi tool-result content. */
function _toolModelContent(
  output: ToolModelOutput
): Extract<AgentMessage, { role: "toolResult" }>["content"] {
  if (output.type === "text") return [{ type: "text", text: output.value }];
  if (output.type === "json") {
    return [{ type: "text", text: JSON.stringify(output.value) ?? "null" }];
  }
  return output.value.map((part) => {
    if (part.type === "text") return part;
    if (part.mediaType.startsWith("image/")) {
      return {
        type: "image" as const,
        data: part.data.data,
        mimeType: part.mediaType,
      };
    }
    return {
      type: "text" as const,
      text: `[file${part.filename === undefined ? "" : ` ${part.filename}`}: ${part.mediaType}]`,
    };
  });
}

/** Makes tool details persistable, falling back to a diagnostic string on cycles. */
function _jsonSafe(value: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(value)) as unknown;
  } catch {
    return String(value);
  }
}

/** Compares duplicate result materialization while ignoring wall-clock metadata. */
function _sameToolResult(
  left: Extract<AgentMessage, { role: "toolResult" }>,
  right: Extract<AgentMessage, { role: "toolResult" }>
): boolean {
  const withoutTimestamp = (
    message: Extract<AgentMessage, { role: "toolResult" }>
  ) =>
    Object.fromEntries(
      Object.entries(message).filter(([key]) => key !== "timestamp")
    );
  return (
    _canonicalJson(withoutTimestamp(left)) ===
    _canonicalJson(withoutTimestamp(right))
  );
}
