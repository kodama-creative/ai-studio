import type {
  Run,
  RunEvent,
  RunOutputSnapshot,
  Thread,
  ThreadCheckpoint,
} from "../domain";

import type { EngineStore, EngineStoreTransaction } from "./engine-store";

interface MemoryState {
  threads: Map<string, Thread>;
  checkpoints: Map<string, ThreadCheckpoint>;
  runs: Map<string, Run>;
  outputs: Map<string, Map<string, RunOutputSnapshot>>;
  events: Map<string, RunEvent[]>;
}

/** Deterministic transaction-capable Store used by Engine interface tests. */
export class InMemoryEngineStore implements EngineStore {
  private _state: MemoryState = _emptyState();

  transaction<T>(fn: (tx: EngineStoreTransaction) => T): T {
    const next = structuredClone(this._state);
    const result = fn(new InMemoryEngineStoreTransaction(next));
    this._state = next;
    return structuredClone(result);
  }

  close(): void {
    // The in-memory Adapter owns no external resources.
  }
}

class InMemoryEngineStoreTransaction implements EngineStoreTransaction {
  constructor(private readonly _state: MemoryState) {}

  getThread(threadId: string): Thread | undefined {
    return _clone(this._state.threads.get(threadId));
  }

  listThreads(): readonly Thread[] {
    return [...this._state.threads.values()].map((value) =>
      structuredClone(value)
    );
  }

  insertThread(thread: Thread): void {
    if (this._state.threads.has(thread.id)) {
      throw new Error(`Thread "${thread.id}" already exists.`);
    }
    this._state.threads.set(thread.id, structuredClone(thread));
  }

  saveThread(thread: Thread, expectedHeadCheckpointId?: string): void {
    const current = this._state.threads.get(thread.id);
    if (current === undefined)
      throw new Error(`Thread "${thread.id}" was not found.`);
    if (
      expectedHeadCheckpointId !== undefined &&
      current.headCheckpointId !== expectedHeadCheckpointId
    ) {
      throw new Error(`Thread "${thread.id}" head changed.`);
    }
    this._state.threads.set(thread.id, structuredClone(thread));
  }

  getCheckpoint(checkpointId: string): ThreadCheckpoint | undefined {
    return _clone(this._state.checkpoints.get(checkpointId));
  }

  listCheckpoints(threadId: string): readonly ThreadCheckpoint[] {
    return [...this._state.checkpoints.values()]
      .filter((value) => value.threadId === threadId)
      .toSorted((left, right) => left.sequence - right.sequence)
      .map((value) => structuredClone(value));
  }

  insertCheckpoint(checkpoint: ThreadCheckpoint): void {
    if (this._state.checkpoints.has(checkpoint.id)) {
      throw new Error(`Checkpoint "${checkpoint.id}" already exists.`);
    }
    this._state.checkpoints.set(checkpoint.id, structuredClone(checkpoint));
  }

  getRun(runId: string): Run | undefined {
    return _clone(this._state.runs.get(runId));
  }

  getRunByOperationId(operationId: string): Run | undefined {
    return _clone(
      [...this._state.runs.values()].find(
        (candidate) => candidate.operationId === operationId
      )
    );
  }

  listRuns(threadId: string): readonly Run[] {
    return [...this._state.runs.values()]
      .filter((value) => value.threadId === threadId)
      .toSorted((left, right) => left.createdAt - right.createdAt)
      .map((value) => structuredClone(value));
  }

  insertRun(run: Run): void {
    if (this._state.runs.has(run.id))
      throw new Error(`Run "${run.id}" already exists.`);
    if (this.getRunByOperationId(run.operationId) !== undefined) {
      throw new Error(`Run operation "${run.operationId}" already exists.`);
    }
    _assertNoActiveRun(this._state.runs.values(), run);
    this._state.runs.set(run.id, structuredClone(run));
  }

  saveRun(run: Run): void {
    if (!this._state.runs.has(run.id))
      throw new Error(`Run "${run.id}" was not found.`);
    _assertNoActiveRun(
      [...this._state.runs.values()].filter(
        (candidate) => candidate.id !== run.id
      ),
      run
    );
    this._state.runs.set(run.id, structuredClone(run));
  }

  claimQueuedRun(input: {
    readonly workerId: string;
    readonly now: number;
    readonly leaseExpiresAt: number;
  }): Run | undefined {
    const queued = [...this._state.runs.values()]
      .filter((run) => run.status === "queued")
      .toSorted((left, right) => left.createdAt - right.createdAt)[0];
    if (queued === undefined) return undefined;
    const claimed: Run = {
      ...queued,
      status: "running",
      workerId: input.workerId,
      leaseExpiresAt: input.leaseExpiresAt,
      startedAt: queued.startedAt ?? input.now,
    };
    this._state.runs.set(claimed.id, structuredClone(claimed));
    return structuredClone(claimed);
  }

  claimExpiredRun(input: {
    readonly runId: string;
    readonly expectedWorkerId?: string;
    readonly expectedLeaseExpiresAt: number;
    readonly workerId: string;
    readonly now: number;
    readonly leaseExpiresAt: number;
  }): Run | undefined {
    const run = this._state.runs.get(input.runId);
    if (
      run?.status !== "running" ||
      run.workerId !== input.expectedWorkerId ||
      run.leaseExpiresAt !== input.expectedLeaseExpiresAt ||
      run.leaseExpiresAt > input.now
    ) {
      return undefined;
    }
    const claimed = {
      ...run,
      workerId: input.workerId,
      leaseExpiresAt: input.leaseExpiresAt,
    };
    this._state.runs.set(run.id, structuredClone(claimed));
    return structuredClone(claimed);
  }

  listExpiredRunningRuns(now: number): readonly Run[] {
    return [...this._state.runs.values()]
      .filter(
        (run) =>
          run.status === "running" &&
          run.leaseExpiresAt !== undefined &&
          run.leaseExpiresAt <= now
      )
      .map((run) => structuredClone(run));
  }

  upsertRunOutput(output: RunOutputSnapshot): void {
    let outputs = this._state.outputs.get(output.runId);
    if (outputs === undefined) {
      outputs = new Map();
      this._state.outputs.set(output.runId, outputs);
    }
    outputs.set(output.message.id, structuredClone(output));
  }

  listRunOutputs(runId: string): readonly RunOutputSnapshot[] {
    return [...(this._state.outputs.get(runId)?.values() ?? [])].map((value) =>
      structuredClone(value)
    );
  }

  appendRunEvent(event: Omit<RunEvent, "cursor">): RunEvent {
    const events = this._state.events.get(event.runId) ?? [];
    const stored: RunEvent = {
      ...structuredClone(event),
      cursor: (events.at(-1)?.cursor ?? 0) + 1,
    };
    events.push(stored);
    this._state.events.set(event.runId, events);
    return structuredClone(stored);
  }

  listRunEvents(runId: string, afterCursor: number): readonly RunEvent[] {
    return (this._state.events.get(runId) ?? [])
      .filter((event) => event.cursor > afterCursor)
      .map((event) => structuredClone(event));
  }

  latestRunEventCursor(runId: string): number {
    return this._state.events.get(runId)?.at(-1)?.cursor ?? 0;
  }
}

function _emptyState(): MemoryState {
  return {
    threads: new Map(),
    checkpoints: new Map(),
    runs: new Map(),
    outputs: new Map(),
    events: new Map(),
  };
}

function _clone<T>(value: T | undefined): T | undefined {
  return value === undefined ? undefined : structuredClone(value);
}

function _assertNoActiveRun(candidates: Iterable<Run>, next: Run): void {
  if (
    next.status !== "queued" &&
    next.status !== "running" &&
    next.status !== "paused"
  ) {
    return;
  }
  if (
    [...candidates].some(
      (candidate) =>
        candidate.threadId === next.threadId &&
        (candidate.status === "queued" ||
          candidate.status === "running" ||
          candidate.status === "paused")
    )
  ) {
    throw new Error(`Thread "${next.threadId}" already has an active Run.`);
  }
}
