import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { Database } from "bun:sqlite";

import type {
  Run,
  RunEvent,
  RunOutputSnapshot,
  Thread,
  ThreadCheckpoint,
} from "../../domain";
import type { EngineStore, EngineStoreTransaction } from "../engine-store";

const SCHEMA_VERSION = 1;

export interface CreateSqliteEngineStoreOptions {
  readonly path: string;
}

/** Creates the Bun SQLite production Adapter for one Engine Runtime. */
export function createSqliteEngineStore(
  options: CreateSqliteEngineStoreOptions
): EngineStore {
  if (options.path !== ":memory:") {
    mkdirSync(dirname(options.path), { recursive: true, mode: 0o700 });
  }
  return new SqliteEngineStore(new Database(options.path, { create: true }));
}

class SqliteEngineStore implements EngineStore {
  constructor(private readonly _database: Database) {
    this._database.run("PRAGMA foreign_keys = ON");
    this._database.run("PRAGMA busy_timeout = 5000");
    if (this._database.filename !== ":memory:") {
      this._database.run("PRAGMA journal_mode = WAL");
      this._database.run("PRAGMA synchronous = NORMAL");
    }
    _migrate(this._database);
  }

  transaction<T>(fn: (tx: EngineStoreTransaction) => T): T {
    return this._database.transaction(() =>
      fn(new SqliteEngineStoreTransaction(this._database))
    )();
  }

  close(): void {
    this._database.close();
  }
}

class SqliteEngineStoreTransaction implements EngineStoreTransaction {
  constructor(private readonly _database: Database) {}

  getThread(threadId: string): Thread | undefined {
    const row = this._database
      .query<ThreadRow, [string]>(`SELECT * FROM engine_threads WHERE id = ?`)
      .get(threadId);
    return row === null ? undefined : _thread(row);
  }

  listThreads(): readonly Thread[] {
    return this._database
      .query<ThreadRow, []>(
        `SELECT * FROM engine_threads ORDER BY created_at, id`
      )
      .all()
      .map(_thread);
  }

  insertThread(thread: Thread): void {
    this._database
      .query(
        `INSERT INTO engine_threads (
          id, schema_version, parent_thread_id, parent_relationship,
          source_checkpoint_id, head_checkpoint_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        thread.id,
        thread.schemaVersion,
        thread.parent?.threadId ?? null,
        thread.parent?.relationship ?? null,
        thread.parent?.sourceCheckpointId ?? null,
        thread.headCheckpointId,
        thread.createdAt,
        thread.updatedAt
      );
  }

  saveThread(thread: Thread, expectedHeadCheckpointId?: string): void {
    const result = this._database
      .query(
        `UPDATE engine_threads SET
          parent_thread_id = ?, parent_relationship = ?, source_checkpoint_id = ?,
          head_checkpoint_id = ?, updated_at = ?
        WHERE id = ?
          AND (? IS NULL OR head_checkpoint_id = ?)`
      )
      .run(
        thread.parent?.threadId ?? null,
        thread.parent?.relationship ?? null,
        thread.parent?.sourceCheckpointId ?? null,
        thread.headCheckpointId,
        thread.updatedAt,
        thread.id,
        expectedHeadCheckpointId ?? null,
        expectedHeadCheckpointId ?? null
      );
    if (result.changes !== 1) {
      if (this.getThread(thread.id) === undefined) {
        throw new Error(`Thread "${thread.id}" was not found.`);
      }
      throw new Error(`Thread "${thread.id}" head changed.`);
    }
  }

  getCheckpoint(checkpointId: string): ThreadCheckpoint | undefined {
    const row = this._database
      .query<CheckpointRow, [string]>(
        `SELECT * FROM engine_checkpoints WHERE id = ?`
      )
      .get(checkpointId);
    return row === null ? undefined : _checkpoint(row);
  }

  listCheckpoints(threadId: string): readonly ThreadCheckpoint[] {
    return this._database
      .query<CheckpointRow, [string]>(
        `SELECT * FROM engine_checkpoints
         WHERE thread_id = ? ORDER BY sequence`
      )
      .all(threadId)
      .map(_checkpoint);
  }

  insertCheckpoint(checkpoint: ThreadCheckpoint): void {
    this._database
      .query(
        `INSERT INTO engine_checkpoints (
          id, schema_version, thread_id, parent_checkpoint_id, sequence,
          source_json, thread_state_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        checkpoint.id,
        checkpoint.schemaVersion,
        checkpoint.threadId,
        checkpoint.parentCheckpointId ?? null,
        checkpoint.sequence,
        _json(checkpoint.source),
        _json(checkpoint.threadState),
        checkpoint.createdAt
      );
  }

  getRun(runId: string): Run | undefined {
    const row = this._database
      .query<RunRow, [string]>(`SELECT * FROM engine_runs WHERE id = ?`)
      .get(runId);
    return row === null ? undefined : _run(row);
  }

  getRunByOperationId(operationId: string): Run | undefined {
    const row = this._database
      .query<RunRow, [string]>(
        `SELECT * FROM engine_runs WHERE operation_id = ?`
      )
      .get(operationId);
    return row === null ? undefined : _run(row);
  }

  listRuns(threadId: string): readonly Run[] {
    return this._database
      .query<RunRow, [string]>(
        `SELECT * FROM engine_runs
         WHERE thread_id = ? ORDER BY created_at, id`
      )
      .all(threadId)
      .map(_run);
  }

  insertRun(run: Run): void {
    this._database
      .query(
        `INSERT INTO engine_runs (
          id, schema_version, thread_id, operation_id, retry_of_run_id,
          input_messages_json, base_checkpoint_id, input_checkpoint_id,
          agent_snapshot_json, status, result_checkpoint_id, error_json,
          worker_id, lease_expires_at, cancel_requested_at, created_at,
          started_at, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(..._runParameters(run));
  }

  saveRun(run: Run): void {
    const result = this._database
      .query(
        `UPDATE engine_runs SET
          retry_of_run_id = ?, input_messages_json = ?,
          base_checkpoint_id = ?, input_checkpoint_id = ?, agent_snapshot_json = ?,
          status = ?, result_checkpoint_id = ?, error_json = ?, worker_id = ?,
          lease_expires_at = ?, cancel_requested_at = ?, started_at = ?,
          completed_at = ?
        WHERE id = ?`
      )
      .run(
        run.retryOfRunId ?? null,
        _json(run.inputMessages),
        run.baseCheckpointId,
        run.inputCheckpointId,
        _json(run.agentSnapshot),
        run.status,
        run.resultCheckpointId ?? null,
        run.error === undefined ? null : _json(run.error),
        run.workerId ?? null,
        run.leaseExpiresAt ?? null,
        run.cancelRequestedAt ?? null,
        run.startedAt ?? null,
        run.completedAt ?? null,
        run.id
      );
    if (result.changes !== 1) throw new Error(`Run "${run.id}" was not found.`);
  }

  claimQueuedRun(input: {
    readonly workerId: string;
    readonly now: number;
    readonly leaseExpiresAt: number;
  }): Run | undefined {
    const row = this._database
      .query<{ id: string }, []>(
        `SELECT id FROM engine_runs
         WHERE status = 'queued' ORDER BY created_at, id LIMIT 1`
      )
      .get();
    if (row === null) return undefined;
    const result = this._database
      .query(
        `UPDATE engine_runs SET
          status = 'running', worker_id = ?, lease_expires_at = ?,
          started_at = COALESCE(started_at, ?)
        WHERE id = ? AND status = 'queued'`
      )
      .run(input.workerId, input.leaseExpiresAt, input.now, row.id);
    return result.changes === 1 ? this.getRun(row.id) : undefined;
  }

  claimExpiredRun(input: {
    readonly runId: string;
    readonly expectedWorkerId?: string;
    readonly expectedLeaseExpiresAt: number;
    readonly workerId: string;
    readonly now: number;
    readonly leaseExpiresAt: number;
  }): Run | undefined {
    const row = this._database
      .query<RunRow, [string, number, string, string | null, number, number]>(
        `UPDATE engine_runs
         SET worker_id = ?, lease_expires_at = ?
         WHERE id = ?
           AND status = 'running'
           AND worker_id IS ?
           AND lease_expires_at = ?
           AND lease_expires_at <= ?
         RETURNING *`
      )
      .get(
        input.workerId,
        input.leaseExpiresAt,
        input.runId,
        input.expectedWorkerId ?? null,
        input.expectedLeaseExpiresAt,
        input.now
      );
    return row === null ? undefined : _run(row);
  }

  listExpiredRunningRuns(now: number): readonly Run[] {
    return this._database
      .query<RunRow, [number]>(
        `SELECT * FROM engine_runs
         WHERE status = 'running'
           AND lease_expires_at IS NOT NULL
           AND lease_expires_at <= ?
         ORDER BY lease_expires_at, id`
      )
      .all(now)
      .map(_run);
  }

  upsertRunOutput(output: RunOutputSnapshot): void {
    this._database
      .query(
        `INSERT INTO engine_run_outputs (
          run_id, message_id, message_json, status, updated_at
        ) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(run_id, message_id) DO UPDATE SET
          message_json = excluded.message_json,
          status = excluded.status,
          updated_at = excluded.updated_at`
      )
      .run(
        output.runId,
        output.message.id,
        _json(output.message),
        output.status,
        output.updatedAt
      );
  }

  listRunOutputs(runId: string): readonly RunOutputSnapshot[] {
    return this._database
      .query<RunOutputRow, [string]>(
        `SELECT * FROM engine_run_outputs
         WHERE run_id = ? ORDER BY updated_at, message_id`
      )
      .all(runId)
      .map((row) => ({
        runId: row.run_id,
        message: _parseJson(row.message_json),
        status: row.status,
        updatedAt: row.updated_at,
      }));
  }

  appendRunEvent(event: Omit<RunEvent, "cursor">): RunEvent {
    const cursor = this.latestRunEventCursor(event.runId) + 1;
    this._database
      .query(
        `INSERT INTO engine_run_events (
          run_id, cursor, timestamp, event_json
        ) VALUES (?, ?, ?, ?)`
      )
      .run(event.runId, cursor, event.timestamp, _json(event.event));
    return { ...event, cursor };
  }

  listRunEvents(runId: string, afterCursor: number): readonly RunEvent[] {
    return this._database
      .query<RunEventRow, [string, number]>(
        `SELECT * FROM engine_run_events
         WHERE run_id = ? AND cursor > ? ORDER BY cursor`
      )
      .all(runId, afterCursor)
      .map((row) => ({
        runId: row.run_id,
        cursor: row.cursor,
        timestamp: row.timestamp,
        event: _parseJson(row.event_json),
      }));
  }

  latestRunEventCursor(runId: string): number {
    const row = this._database
      .query<{ cursor: number | null }, [string]>(
        `SELECT MAX(cursor) AS cursor FROM engine_run_events WHERE run_id = ?`
      )
      .get(runId);
    return row?.cursor ?? 0;
  }
}

interface ThreadRow {
  id: string;
  schema_version: number;
  parent_thread_id: string | null;
  parent_relationship: "retry" | "fork" | null;
  source_checkpoint_id: string | null;
  head_checkpoint_id: string;
  created_at: number;
  updated_at: number;
}

interface CheckpointRow {
  id: string;
  schema_version: number;
  thread_id: string;
  parent_checkpoint_id: string | null;
  sequence: number;
  source_json: string;
  thread_state_json: string;
  created_at: number;
}

interface RunRow {
  id: string;
  schema_version: number;
  thread_id: string;
  operation_id: string;
  retry_of_run_id: string | null;
  input_messages_json: string;
  base_checkpoint_id: string;
  input_checkpoint_id: string;
  agent_snapshot_json: string;
  status: Run["status"];
  result_checkpoint_id: string | null;
  error_json: string | null;
  worker_id: string | null;
  lease_expires_at: number | null;
  cancel_requested_at: number | null;
  created_at: number;
  started_at: number | null;
  completed_at: number | null;
}

interface RunOutputRow {
  run_id: string;
  message_id: string;
  message_json: string;
  status: RunOutputSnapshot["status"];
  updated_at: number;
}

interface RunEventRow {
  run_id: string;
  cursor: number;
  timestamp: number;
  event_json: string;
}

function _migrate(database: Database): void {
  database.run(`
    CREATE TABLE IF NOT EXISTS engine_schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )
  `);
  const current =
    database
      .query<{ version: number | null }, []>(
        `SELECT MAX(version) AS version FROM engine_schema_migrations`
      )
      .get()?.version ?? 0;
  if (current > SCHEMA_VERSION) {
    throw new Error(
      `Engine database schema ${current} is newer than supported.`
    );
  }
  if (current === SCHEMA_VERSION) return;

  database.transaction(() => {
    database.run(`
      CREATE TABLE engine_threads (
        id TEXT PRIMARY KEY,
        schema_version INTEGER NOT NULL,
        parent_thread_id TEXT,
        parent_relationship TEXT,
        source_checkpoint_id TEXT,
        head_checkpoint_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY(parent_thread_id) REFERENCES engine_threads(id)
      )
    `);
    database.run(`
      CREATE TABLE engine_checkpoints (
        id TEXT PRIMARY KEY,
        schema_version INTEGER NOT NULL,
        thread_id TEXT NOT NULL,
        parent_checkpoint_id TEXT,
        sequence INTEGER NOT NULL,
        source_json TEXT NOT NULL,
        thread_state_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE(thread_id, sequence),
        FOREIGN KEY(thread_id) REFERENCES engine_threads(id),
        FOREIGN KEY(parent_checkpoint_id) REFERENCES engine_checkpoints(id)
      )
    `);
    database.run(`
      CREATE TABLE engine_runs (
        id TEXT PRIMARY KEY,
        schema_version INTEGER NOT NULL,
        thread_id TEXT NOT NULL,
        operation_id TEXT NOT NULL UNIQUE,
        retry_of_run_id TEXT,
        input_messages_json TEXT NOT NULL,
        base_checkpoint_id TEXT NOT NULL,
        input_checkpoint_id TEXT NOT NULL,
        agent_snapshot_json TEXT NOT NULL,
        status TEXT NOT NULL,
        result_checkpoint_id TEXT,
        error_json TEXT,
        worker_id TEXT,
        lease_expires_at INTEGER,
        cancel_requested_at INTEGER,
        created_at INTEGER NOT NULL,
        started_at INTEGER,
        completed_at INTEGER,
        FOREIGN KEY(thread_id) REFERENCES engine_threads(id),
        FOREIGN KEY(retry_of_run_id) REFERENCES engine_runs(id),
        FOREIGN KEY(base_checkpoint_id) REFERENCES engine_checkpoints(id),
        FOREIGN KEY(input_checkpoint_id) REFERENCES engine_checkpoints(id),
        FOREIGN KEY(result_checkpoint_id) REFERENCES engine_checkpoints(id)
      )
    `);
    database.run(`
      CREATE UNIQUE INDEX engine_one_active_run_per_thread
      ON engine_runs(thread_id)
      WHERE status IN ('queued', 'running')
    `);
    database.run(`
      CREATE INDEX engine_runs_claim
      ON engine_runs(status, created_at)
    `);
    database.run(`
      CREATE TABLE engine_run_outputs (
        run_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        message_json TEXT NOT NULL,
        status TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY(run_id, message_id),
        FOREIGN KEY(run_id) REFERENCES engine_runs(id)
      )
    `);
    database.run(`
      CREATE TABLE engine_run_events (
        run_id TEXT NOT NULL,
        cursor INTEGER NOT NULL,
        timestamp INTEGER NOT NULL,
        event_json TEXT NOT NULL,
        PRIMARY KEY(run_id, cursor),
        FOREIGN KEY(run_id) REFERENCES engine_runs(id)
      )
    `);
    database.run(
      `INSERT INTO engine_schema_migrations (version, applied_at) VALUES (?, ?)`,
      [SCHEMA_VERSION, Date.now()]
    );
  })();
}

function _thread(row: ThreadRow): Thread {
  return {
    schemaVersion: 1,
    id: row.id,
    ...(row.parent_thread_id === null ||
    row.parent_relationship === null ||
    row.source_checkpoint_id === null
      ? {}
      : {
          parent: {
            threadId: row.parent_thread_id,
            relationship: row.parent_relationship,
            sourceCheckpointId: row.source_checkpoint_id,
          },
        }),
    headCheckpointId: row.head_checkpoint_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function _checkpoint(row: CheckpointRow): ThreadCheckpoint {
  return {
    schemaVersion: 1,
    id: row.id,
    threadId: row.thread_id,
    ...(row.parent_checkpoint_id === null
      ? {}
      : { parentCheckpointId: row.parent_checkpoint_id }),
    sequence: row.sequence,
    source: _parseJson(row.source_json),
    threadState: _parseJson(row.thread_state_json),
    createdAt: row.created_at,
  };
}

function _run(row: RunRow): Run {
  return {
    schemaVersion: 1,
    id: row.id,
    threadId: row.thread_id,
    operationId: row.operation_id,
    ...(row.retry_of_run_id === null
      ? {}
      : { retryOfRunId: row.retry_of_run_id }),
    inputMessages: _parseJson(row.input_messages_json),
    baseCheckpointId: row.base_checkpoint_id,
    inputCheckpointId: row.input_checkpoint_id,
    agentSnapshot: _parseJson(row.agent_snapshot_json),
    status: row.status,
    ...(row.result_checkpoint_id === null
      ? {}
      : { resultCheckpointId: row.result_checkpoint_id }),
    ...(row.error_json === null ? {} : { error: _parseJson(row.error_json) }),
    ...(row.worker_id === null ? {} : { workerId: row.worker_id }),
    ...(row.lease_expires_at === null
      ? {}
      : { leaseExpiresAt: row.lease_expires_at }),
    ...(row.cancel_requested_at === null
      ? {}
      : { cancelRequestedAt: row.cancel_requested_at }),
    createdAt: row.created_at,
    ...(row.started_at === null ? {} : { startedAt: row.started_at }),
    ...(row.completed_at === null ? {} : { completedAt: row.completed_at }),
  };
}

function _runParameters(
  run: Run
): Parameters<ReturnType<Database["query"]>["run"]> {
  return [
    run.id,
    run.schemaVersion,
    run.threadId,
    run.operationId,
    run.retryOfRunId ?? null,
    _json(run.inputMessages),
    run.baseCheckpointId,
    run.inputCheckpointId,
    _json(run.agentSnapshot),
    run.status,
    run.resultCheckpointId ?? null,
    run.error === undefined ? null : _json(run.error),
    run.workerId ?? null,
    run.leaseExpiresAt ?? null,
    run.cancelRequestedAt ?? null,
    run.createdAt,
    run.startedAt ?? null,
    run.completedAt ?? null,
  ];
}

function _json(value: unknown): string {
  const encoded = JSON.stringify(value);
  if (encoded === undefined)
    throw new Error("Engine Store value is not JSON serializable.");
  return encoded;
}

function _parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}
