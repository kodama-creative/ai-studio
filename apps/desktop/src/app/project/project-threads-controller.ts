import type {
  StudioRunHistoryEntry,
  StudioThread,
  StudioThreadEventData,
} from "@llm-space/studio";
import type { StudioEvaluationMetadata } from "@llm-space/studio/evaluation";

import type { StudioTransport } from "@/shared/studio-rpc";

const EMPTY_EVALUATION_METADATA: StudioEvaluationMetadata = {
  evaluations: [],
  rubrics: [],
};

export interface ProjectThreadsSnapshot {
  readonly threads: readonly StudioThread[];
  readonly activeThread?: StudioThread;
  readonly openingThreadId?: string;
  readonly runHistory: ReadonlyMap<
    string,
    readonly StudioRunHistoryEntry[]
  >;
  readonly evaluationMetadata: ReadonlyMap<
    string,
    StudioEvaluationMetadata
  >;
  readonly loading: boolean;
  readonly openError?: string;
}

export interface ProjectThreadsControllerOptions {
  readonly client: StudioTransport;
  readonly reportError: (title: string, error: unknown) => void;
}

type Listener = () => void;

/**
 * Owns Project Studio Thread collection state and its RPC lifecycle.
 *
 * Callers subscribe to immutable snapshots, call `start()`/`stop()` with their
 * own lifecycle, and never coordinate event cursors, stale opens, or stream
 * cancellation themselves.
 */
export class ProjectThreadsController {
  private readonly _listeners = new Set<Listener>();
  private readonly _lastSequences = new Map<string, number>();
  private _eventSubscription?: AbortController;
  private _lifecycle = 0;
  private _mutationRequest = 0;
  private _openRequest = 0;
  private _started = false;
  private _snapshot: ProjectThreadsSnapshot = {
    threads: [],
    runHistory: new Map(),
    evaluationMetadata: new Map(),
    loading: true,
  };

  constructor(private readonly _options: ProjectThreadsControllerOptions) {}

  readonly getSnapshot = (): ProjectThreadsSnapshot => this._snapshot;

  readonly subscribe = (listener: Listener): (() => void) => {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  };

  /** Start or restart the controller and open the first durable Thread. */
  async start(): Promise<StudioThread | undefined> {
    const lifecycle = ++this._lifecycle;
    const selection = this._beginSelection();
    this._started = true;
    this._setSnapshot({ ...this._snapshot, loading: true });
    try {
      const threads = await this._options.client.listThreads();
      if (!this._isCurrentOpen(lifecycle, selection)) return undefined;
      const first = threads[0];
      this._setSnapshot({
        ...this._snapshot,
        threads,
        ...(first === undefined
          ? {
              activeThread: undefined,
              openingThreadId: undefined,
              openError: undefined,
            }
          : {}),
      });
      return first === undefined
        ? undefined
        : await this._open(first.id, lifecycle);
    } catch (error) {
      if (this._isCurrentOpen(lifecycle, selection)) {
        this._options.reportError("Unable to load Project Threads", error);
      }
      return undefined;
    } finally {
      if (this._isCurrentLifecycle(lifecycle)) {
        this._setSnapshot({ ...this._snapshot, loading: false });
      }
    }
  }

  /** Stop all live work. A later `start()` creates a fresh lifecycle. */
  stop(): void {
    this._started = false;
    this._lifecycle += 1;
    this._mutationRequest += 1;
    this._openRequest += 1;
    this._eventSubscription?.abort();
    this._eventSubscription = undefined;
  }

  /** Open one Thread; only the most recent request may publish its result. */
  open(threadId: string): Promise<StudioThread | undefined> {
    this._requireStarted();
    return this._open(threadId, this._lifecycle);
  }

  /** Create and select one new independent Studio Thread. */
  async create(): Promise<StudioThread | undefined> {
    this._requireStarted();
    const lifecycle = this._lifecycle;
    const mutation = ++this._mutationRequest;
    const selection = this._openRequest;
    try {
      const thread = await this._options.client.createThread();
      if (!this._isCurrentMutation(lifecycle, mutation, selection)) {
        return undefined;
      }
      await this.refresh();
      if (!this._isCurrentMutation(lifecycle, mutation, selection)) {
        return undefined;
      }
      this._beginSelection();
      this._selectThread(thread, [], EMPTY_EVALUATION_METADATA);
      return thread;
    } catch (error) {
      if (this._isCurrentMutation(lifecycle, mutation, selection)) {
        this._options.reportError("Unable to create Thread", error);
      }
      return undefined;
    }
  }

  /** Fork a durable checkpoint and select the resulting Thread. */
  async fork(
    threadId: string,
    entryId?: string
  ): Promise<StudioThread | undefined> {
    this._requireStarted();
    const lifecycle = this._lifecycle;
    const mutation = ++this._mutationRequest;
    const selection = this._openRequest;
    try {
      const fork = await this._options.client.forkThread(threadId, {
        ...(entryId === undefined ? {} : { entryId }),
      });
      if (!this._isCurrentMutation(lifecycle, mutation, selection)) {
        return undefined;
      }
      await this.refresh();
      if (!this._isCurrentMutation(lifecycle, mutation, selection)) {
        return undefined;
      }
      return await this._open(fork.id, this._lifecycle);
    } catch (error) {
      if (this._isCurrentMutation(lifecycle, mutation, selection)) {
        this._options.reportError("Unable to fork Thread", error);
      }
      return undefined;
    }
  }

  /** Refresh collection metadata without disturbing the current selection. */
  async refresh(): Promise<void> {
    if (!this._started) return;
    const lifecycle = this._lifecycle;
    const threads = await this._options.client.listThreads();
    if (!this._isCurrentLifecycle(lifecycle)) return;
    const activeThread = this._snapshot.activeThread;
    this._setSnapshot({
      ...this._snapshot,
      threads,
      ...(activeThread === undefined
        ? {}
        : {
            activeThread:
              threads.find((item) => item.id === activeThread.id) ??
              activeThread,
          }),
    });
  }

  /** Accept a projection committed by the active Thread editor/runtime. */
  acceptThreadProjection(thread: StudioThread): void {
    if (!this._started || this._snapshot.activeThread?.id !== thread.id) return;
    this._setSnapshot({
      ...this._snapshot,
      activeThread: thread,
      threads: this._snapshot.threads.map((item) =>
        item.id === thread.id ? thread : item
      ),
    });
  }

  private async _open(
    threadId: string,
    lifecycle: number
  ): Promise<StudioThread | undefined> {
    const request = this._beginSelection();
    this._setSnapshot({
      ...this._snapshot,
      openingThreadId: threadId,
      openError: undefined,
    });
    try {
      const [thread, history, evaluationMetadata] =
        await this._loadThreadData(threadId);
      if (!this._isCurrentOpen(lifecycle, request)) return undefined;
      if (thread === undefined) {
        throw new Error(`Thread "${threadId}" was not found.`);
      }
      this._selectThread(thread, history, evaluationMetadata);
      return thread;
    } catch (error) {
      if (!this._isCurrentOpen(lifecycle, request)) return undefined;
      const message = _errorMessage(error);
      this._setSnapshot({
        ...this._snapshot,
        activeThread: undefined,
        openingThreadId: undefined,
        openError: message,
      });
      this._options.reportError("Unable to open Thread", error);
      return undefined;
    }
  }

  private _selectThread(
    thread: StudioThread,
    history: readonly StudioRunHistoryEntry[],
    evaluationMetadata: StudioEvaluationMetadata
  ): void {
    this._publishThreadData(thread, history, evaluationMetadata);
    this._subscribeToEvents(thread.id, this._openRequest, this._lifecycle);
  }

  private _publishThreadData(
    thread: StudioThread,
    history: readonly StudioRunHistoryEntry[],
    evaluationMetadata: StudioEvaluationMetadata,
    threads: readonly StudioThread[] = this._snapshot.threads
  ): void {
    const runHistory = new Map(this._snapshot.runHistory).set(
      thread.id,
      history
    );
    const evaluations = new Map(this._snapshot.evaluationMetadata).set(
      thread.id,
      evaluationMetadata
    );
    this._setSnapshot({
      ...this._snapshot,
      activeThread: thread,
      threads,
      openingThreadId: undefined,
      openError: undefined,
      runHistory,
      evaluationMetadata: evaluations,
    });
  }

  private _subscribeToEvents(
    threadId: string,
    request: number,
    lifecycle: number
  ): void {
    this._eventSubscription?.abort();
    const controller = new AbortController();
    this._eventSubscription = controller;
    void (async () => {
      try {
        for await (const item of this._options.client.events(threadId, {
          afterSequence: this._lastSequences.get(threadId),
          signal: controller.signal,
        })) {
          this._lastSequences.set(threadId, item.sequence);
          if (!this._isCurrentOpen(lifecycle, request)) return;
          if (item.event.type === "conversation.updated") {
            this.acceptThreadProjection(item.event.thread);
          }
          if (_isTerminalRunEvent(item.event)) {
            const [[thread, history, evaluationMetadata], threads] =
              await Promise.all([
                this._loadThreadData(threadId),
                this._options.client.listThreads(),
              ]);
            if (!this._isCurrentOpen(lifecycle, request)) return;
            if (thread === undefined) {
              this._setSnapshot({ ...this._snapshot, threads });
            } else {
              this._publishThreadData(
                thread,
                history,
                evaluationMetadata,
                threads
              );
            }
          }
        }
      } catch (error) {
        if (!controller.signal.aborted && this._isCurrentLifecycle(lifecycle)) {
          this._options.reportError("Studio Thread stream failed", error);
        }
      }
    })();
  }

  private _setSnapshot(snapshot: ProjectThreadsSnapshot): void {
    this._snapshot = snapshot;
    for (const listener of this._listeners) listener();
  }

  private _loadThreadData(threadId: string) {
    return Promise.all([
      this._options.client.loadThread(threadId),
      this._options.client.listRunHistory(threadId),
      this._options.client.listEvaluationMetadata(threadId),
    ] as const);
  }

  private _beginSelection(): number {
    this._mutationRequest += 1;
    this._eventSubscription?.abort();
    this._eventSubscription = undefined;
    return ++this._openRequest;
  }

  private _isCurrentLifecycle(lifecycle: number): boolean {
    return this._started && this._lifecycle === lifecycle;
  }

  private _isCurrentOpen(lifecycle: number, request: number): boolean {
    return (
      this._isCurrentLifecycle(lifecycle) && this._openRequest === request
    );
  }

  private _isCurrentMutation(
    lifecycle: number,
    mutation: number,
    selection: number
  ): boolean {
    return (
      this._isCurrentLifecycle(lifecycle) &&
      this._mutationRequest === mutation &&
      this._openRequest === selection
    );
  }

  private _requireStarted(): void {
    if (!this._started) {
      throw new Error("ProjectThreadsController must be started first.");
    }
  }
}

function _isTerminalRunEvent(event: StudioThreadEventData): boolean {
  return (
    event.type === "operation.completed" ||
    event.type === "operation.failed" ||
    event.type === "operation.aborted"
  );
}

function _errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
