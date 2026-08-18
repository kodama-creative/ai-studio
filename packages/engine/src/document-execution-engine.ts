import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type {
  DurablePiRuntime,
  PiCommittedChange,
  PiSessionSnapshot,
  RuntimeBinding,
  RuntimeEphemeralEvent,
} from "@llm-space/pi-runtime";

export type DocumentDriveMode = "step" | "turn" | "continue";

export type DocumentExecutionEvent =
  | { readonly type: "committed"; readonly change: PiCommittedChange }
  | { readonly type: "ephemeral"; readonly event: RuntimeEphemeralEvent }
  | { readonly type: "state"; readonly state: "running" };

export interface DocumentAdmissionInput {
  readonly operationId: string;
  readonly sessionId: string;
  readonly lane?: string;
  readonly messages: readonly AgentMessage[];
  readonly messageIds?: readonly string[];
  readonly binding:
    | RuntimeBinding
    | (() => RuntimeBinding | Promise<RuntimeBinding>);
  readonly signal?: AbortSignal;
}

export interface DocumentActionInput {
  readonly sessionId: string;
  readonly lane?: string;
  readonly operationId: string;
  readonly expectedActionId: string;
  readonly kind: "model" | "tool";
  readonly signal?: AbortSignal;
}

/**
 * Product-neutral execution facade over one durable Pi Session runtime.
 * It owns operation admission and drive-mode semantics but no product tables.
 */
export class DocumentExecutionEngine {
  private readonly _stateListeners = new Map<
    string,
    Set<(event: Extract<DocumentExecutionEvent, { type: "state" }>) => void>
  >();

  constructor(private readonly _runtime: DurablePiRuntime) {}

  /** Freezes the operation binding and admits its immutable prompt without effects. */
  async admit(input: DocumentAdmissionInput): Promise<PiSessionSnapshot> {
    input.signal?.throwIfAborted();
    return this._runtime.start({
      operationId: input.operationId,
      sessionId: input.sessionId,
      ...(input.lane === undefined ? {} : { lane: input.lane }),
      messages: [...input.messages],
      ...(input.messageIds === undefined
        ? {}
        : { messageIds: [...input.messageIds] }),
      binding: input.binding,
    });
  }

  /** Drives an admitted operation according to the shared debugger vocabulary. */
  async drive(input: {
    readonly sessionId: string;
    readonly lane?: string;
    readonly operationId: string;
    readonly mode: DocumentDriveMode;
    readonly signal?: AbortSignal;
  }): Promise<PiSessionSnapshot> {
    input.signal?.throwIfAborted();
    const current = await this._runtime.open(input);
    _assertOperation(current, input.operationId);
    if (input.mode === "continue") {
      this._publishRunning(input.sessionId);
      return this._runtime.continue(input);
    }
    if (current.nextAction === undefined) return current;
    return input.mode === "step"
      ? this.step({
          ...input,
          expectedActionId: current.nextAction.id,
          kind: current.nextAction.kind,
        })
      : this.turn({
          ...input,
          expectedActionId: current.nextAction.id,
          kind: current.nextAction.kind,
        });
  }

  /** Releases exactly one stable Pi semantic action. Pi itself deduplicates retries. */
  async step(input: DocumentActionInput): Promise<PiSessionSnapshot> {
    input.signal?.throwIfAborted();
    const current = await this._runtime.open(input);
    _assertOperation(current, input.operationId);
    this._publishRunning(input.sessionId);
    return this._runtime.step({
      sessionId: input.sessionId,
      ...(input.lane === undefined ? {} : { lane: input.lane }),
      expectedActionId: input.expectedActionId,
      kind: input.kind,
    });
  }

  /** Runs one model action and its immediately following tool actions. */
  async turn(input: DocumentActionInput): Promise<PiSessionSnapshot> {
    let snapshot = await this.step(input);
    while (snapshot.nextAction?.kind === "tool") {
      input.signal?.throwIfAborted();
      snapshot = await this._runtime.step({
        sessionId: input.sessionId,
        ...(input.lane === undefined ? {} : { lane: input.lane }),
        expectedActionId: snapshot.nextAction.id,
        kind: "tool",
      });
    }
    return snapshot;
  }

  open(input: { readonly sessionId: string; readonly lane?: string }) {
    return this._runtime.open(input);
  }

  readCommitted(input: {
    readonly sessionId: string;
    readonly lane?: string;
    readonly afterSeq?: number;
  }): Promise<PiCommittedChange> {
    return this._runtime.readCommitted(input);
  }

  watch(input: {
    readonly sessionId: string;
    readonly lane?: string;
    readonly afterSeq?: number;
    readonly signal?: AbortSignal;
  }): AsyncIterable<PiCommittedChange> {
    return this._runtime.watch(input);
  }

  subscribe(
    sessionId: string,
    listener: (event: RuntimeEphemeralEvent) => void | Promise<void>
  ): () => void {
    return this._runtime.subscribe(sessionId, listener);
  }

  /**
   * Merges durable replay frames and live model deltas into one ordered host
   * observation stream. Durable frames alone advance the reconnect cursor.
   */
  async *observe(input: {
    readonly sessionId: string;
    readonly lane?: string;
    readonly afterSeq?: number;
    readonly signal?: AbortSignal;
  }): AsyncIterable<DocumentExecutionEvent> {
    const queue: DocumentExecutionEvent[] = [];
    let wake: (() => void) | undefined;
    let failure: unknown;
    let committedDone = false;
    const publish = (event: DocumentExecutionEvent) => {
      queue.push(event);
      wake?.();
      wake = undefined;
    };
    const unsubscribe = this.subscribe(input.sessionId, (event) =>
      publish({ type: "ephemeral", event })
    );
    const unsubscribeState = this._subscribeState(input.sessionId, publish);
    const committed = this.watch(input)[Symbol.asyncIterator]();
    const pump = (async () => {
      try {
        while (!input.signal?.aborted) {
          const next = await committed.next();
          if (next.done) break;
          publish({ type: "committed", change: next.value });
        }
      } catch (error) {
        failure = error;
      } finally {
        committedDone = true;
        wake?.();
        wake = undefined;
      }
    })();
    try {
      while (!input.signal?.aborted) {
        const event = queue.shift();
        if (event !== undefined) {
          yield event;
          continue;
        }
        if (committedDone) {
          if (failure !== undefined) {
            throw failure instanceof Error
              ? failure
              : new Error("Committed observation stream failed.", {
                  cause: failure,
                });
          }
          break;
        }
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
    } finally {
      unsubscribeState();
      unsubscribe();
      await committed.return?.();
      await pump;
    }
  }

  resolveToolPermission(input: {
    readonly sessionId: string;
    readonly lane?: string;
    readonly toolCallId: string;
    readonly approved: boolean;
  }): Promise<PiSessionSnapshot> {
    return this._runtime.resolveToolApproval(input);
  }

  cancel(input: {
    readonly sessionId: string;
    readonly lane?: string;
  }): Promise<PiSessionSnapshot> {
    return this._runtime.abort(input);
  }

  private _subscribeState(
    sessionId: string,
    listener: (event: DocumentExecutionEvent) => void
  ): () => void {
    const listeners = this._stateListeners.get(sessionId) ?? new Set();
    listeners.add(listener);
    this._stateListeners.set(sessionId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this._stateListeners.delete(sessionId);
    };
  }

  private _publishRunning(sessionId: string): void {
    for (const listener of this._stateListeners.get(sessionId) ?? []) {
      listener({ type: "state", state: "running" });
    }
  }
}

function _assertOperation(
  snapshot: PiSessionSnapshot,
  expectedOperationId: string
): void {
  if (snapshot.operationId !== expectedOperationId) {
    throw new Error(
      `Pi Session is not running operation "${expectedOperationId}".`
    );
  }
}
