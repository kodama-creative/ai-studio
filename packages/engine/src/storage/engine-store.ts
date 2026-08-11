import type {
  Run,
  RunEvent,
  RunOutputSnapshot,
  Thread,
  ThreadCheckpoint,
} from "../domain";

/** Mutable store view used only inside one synchronous atomic transaction. */
export interface EngineStoreTransaction {
  getThread(threadId: string): Thread | undefined;
  listThreads(): readonly Thread[];
  insertThread(thread: Thread): void;
  saveThread(thread: Thread, expectedHeadCheckpointId?: string): void;

  getCheckpoint(checkpointId: string): ThreadCheckpoint | undefined;
  listCheckpoints(threadId: string): readonly ThreadCheckpoint[];
  insertCheckpoint(checkpoint: ThreadCheckpoint): void;

  getRun(runId: string): Run | undefined;
  getRunByOperationId(operationId: string): Run | undefined;
  listRuns(threadId: string): readonly Run[];
  insertRun(run: Run): void;
  saveRun(run: Run): void;
  claimQueuedRun(input: {
    readonly workerId: string;
    readonly now: number;
    readonly leaseExpiresAt: number;
  }): Run | undefined;
  claimExpiredRun(input: {
    readonly runId: string;
    readonly expectedWorkerId?: string;
    readonly expectedLeaseExpiresAt: number;
    readonly workerId: string;
    readonly now: number;
    readonly leaseExpiresAt: number;
  }): Run | undefined;
  listExpiredRunningRuns(now: number): readonly Run[];

  upsertRunOutput(output: RunOutputSnapshot): void;
  listRunOutputs(runId: string): readonly RunOutputSnapshot[];

  appendRunEvent(event: Omit<RunEvent, "cursor">): RunEvent;
  listRunEvents(runId: string, afterCursor: number): readonly RunEvent[];
  latestRunEventCursor(runId: string): number;
}

/**
 * Internal persistence seam for Engine state.
 *
 * Transactions are deliberately synchronous so SQLite can guarantee atomicity
 * without keeping a database transaction open across awaited model/tool I/O.
 */
export interface EngineStore {
  transaction<T>(fn: (tx: EngineStoreTransaction) => T): T;
  close(): void;
}
