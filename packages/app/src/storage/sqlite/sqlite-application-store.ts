import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { Database } from "bun:sqlite";

import type {
  ApplicationRunIntent,
  Session,
  SessionMessage,
  SessionRunLink,
  Task,
} from "../../domain";
import type {
  ApplicationStore,
  ApplicationStoreTransaction,
} from "../application-store";

const SCHEMA_VERSION = 1;

export interface CreateSqliteApplicationStoreOptions {
  readonly path: string;
}

/** Creates the SQLite Adapter for Application-owned tables. */
export function createSqliteApplicationStore(
  options: CreateSqliteApplicationStoreOptions
): ApplicationStore {
  if (options.path !== ":memory:") {
    mkdirSync(dirname(options.path), { recursive: true, mode: 0o700 });
  }
  return new SqliteApplicationStore(
    new Database(options.path, { create: true })
  );
}

class SqliteApplicationStore implements ApplicationStore {
  constructor(private readonly _database: Database) {
    this._database.run("PRAGMA foreign_keys = ON");
    this._database.run("PRAGMA busy_timeout = 5000");
    if (this._database.filename !== ":memory:") {
      this._database.run("PRAGMA journal_mode = WAL");
      this._database.run("PRAGMA synchronous = NORMAL");
    }
    _migrate(this._database);
  }

  transaction<T>(fn: (tx: ApplicationStoreTransaction) => T): T {
    return this._database.transaction(() =>
      fn(new SqliteApplicationTransaction(this._database))
    )();
  }

  close(): void {
    this._database.close();
  }
}

class SqliteApplicationTransaction implements ApplicationStoreTransaction {
  constructor(private readonly _database: Database) {}

  getSession(sessionId: string): Session | undefined {
    const row = this._database
      .query<SessionRow, [string]>("SELECT * FROM app_sessions WHERE id = ?")
      .get(sessionId);
    return row === null ? undefined : _session(row);
  }

  listSessions(): readonly Session[] {
    return this._database
      .query<SessionRow, []>(
        "SELECT * FROM app_sessions ORDER BY created_at, id"
      )
      .all()
      .map(_session);
  }

  insertSession(session: Session): void {
    this._database
      .query(
        `INSERT INTO app_sessions (
          id, schema_version, project_id, thread_id, agent_id, title,
          status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        session.id,
        session.schemaVersion,
        session.projectId ?? null,
        session.threadId,
        session.agentId,
        session.title,
        session.status,
        session.createdAt,
        session.updatedAt
      );
  }

  saveSession(session: Session): void {
    const result = this._database
      .query(
        `UPDATE app_sessions SET
          project_id = ?, thread_id = ?, agent_id = ?, title = ?, status = ?, updated_at = ?
        WHERE id = ?`
      )
      .run(
        session.projectId ?? null,
        session.threadId,
        session.agentId,
        session.title,
        session.status,
        session.updatedAt,
        session.id
      );
    if (result.changes !== 1)
      throw new Error(`Session "${session.id}" was not found.`);
  }

  getTask(taskId: string): Task | undefined {
    const row = this._database
      .query<TaskRow, [string]>("SELECT * FROM app_tasks WHERE id = ?")
      .get(taskId);
    return row === null ? undefined : _task(row);
  }

  listTasks(sessionId: string): readonly Task[] {
    return this._database
      .query<TaskRow, [string]>(
        "SELECT * FROM app_tasks WHERE session_id = ? ORDER BY created_at, id"
      )
      .all(sessionId)
      .map(_task);
  }

  insertTask(task: Task): void {
    this._database
      .query(
        `INSERT INTO app_tasks (
          id, schema_version, session_id, title, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        task.id,
        task.schemaVersion,
        task.sessionId,
        task.title,
        task.status,
        task.createdAt,
        task.updatedAt
      );
  }

  saveTask(task: Task): void {
    const result = this._database
      .query(
        "UPDATE app_tasks SET title = ?, status = ?, updated_at = ? WHERE id = ?"
      )
      .run(task.title, task.status, task.updatedAt, task.id);
    if (result.changes !== 1)
      throw new Error(`Task "${task.id}" was not found.`);
  }

  upsertSessionMessage(message: SessionMessage): "inserted" | "updated" {
    const current = this._database
      .query<{ payload_json: string }, [string]>(
        "SELECT payload_json FROM app_session_messages WHERE id = ?"
      )
      .get(message.id);
    const stored =
      current === null
        ? message
        : {
            ...message,
            createdAt: _parseJson<SessionMessage>(current.payload_json)
              .createdAt,
          };
    const result = this._database
      .query(
        `INSERT INTO app_session_messages (
          id, schema_version, session_id, type, payload_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          type = excluded.type,
          payload_json = excluded.payload_json`
      )
      .run(
        message.id,
        stored.schemaVersion,
        stored.sessionId,
        stored.type,
        _json(stored),
        stored.createdAt
      );
    void result;
    return current === null ? "inserted" : "updated";
  }

  listSessionMessages(sessionId: string): readonly SessionMessage[] {
    return this._database
      .query<{ payload_json: string }, [string]>(
        `SELECT payload_json FROM app_session_messages
         WHERE session_id = ? ORDER BY created_at, rowid`
      )
      .all(sessionId)
      .map((row) => _parseJson(row.payload_json));
  }

  insertRunLink(link: SessionRunLink): "inserted" | "existing" {
    const result = this._database
      .query(
        `INSERT INTO app_session_run_links (
          run_id, schema_version, session_id, thread_id, task_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(run_id) DO NOTHING`
      )
      .run(
        link.runId,
        link.schemaVersion,
        link.sessionId,
        link.threadId,
        link.taskId ?? null,
        link.createdAt
      );
    return result.changes === 1 ? "inserted" : "existing";
  }

  getRunLink(runId: string): SessionRunLink | undefined {
    const row = this._database
      .query<RunLinkRow, [string]>(
        "SELECT * FROM app_session_run_links WHERE run_id = ?"
      )
      .get(runId);
    return row === null ? undefined : _runLink(row);
  }

  listRunLinks(sessionId: string): readonly SessionRunLink[] {
    return this._database
      .query<RunLinkRow, [string]>(
        `SELECT * FROM app_session_run_links
         WHERE session_id = ? ORDER BY rowid`
      )
      .all(sessionId)
      .map(_runLink);
  }

  getRunIntent(operationId: string): ApplicationRunIntent | undefined {
    const row = this._database
      .query<{ payload_json: string }, [string]>(
        "SELECT payload_json FROM app_run_intents WHERE operation_id = ?"
      )
      .get(operationId);
    return row === null ? undefined : _parseJson(row.payload_json);
  }

  listRunIntents(): readonly ApplicationRunIntent[] {
    return this._database
      .query<{ payload_json: string }, []>(
        "SELECT payload_json FROM app_run_intents ORDER BY created_at, rowid"
      )
      .all()
      .map((row) => _parseJson(row.payload_json));
  }

  insertRunIntent(intent: ApplicationRunIntent): void {
    this._database
      .query(
        `INSERT INTO app_run_intents (
          operation_id, schema_version, session_id, payload_json, created_at
        ) VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        intent.operationId,
        intent.schemaVersion,
        intent.sessionId,
        _json(intent),
        intent.createdAt
      );
  }

  deleteRunIntent(operationId: string): void {
    this._database
      .query("DELETE FROM app_run_intents WHERE operation_id = ?")
      .run(operationId);
  }
}

interface SessionRow {
  id: string;
  schema_version: number;
  project_id: string | null;
  thread_id: string;
  agent_id: string;
  title: string;
  status: Session["status"];
  created_at: number;
  updated_at: number;
}

interface TaskRow {
  id: string;
  schema_version: number;
  session_id: string;
  title: string;
  status: Task["status"];
  created_at: number;
  updated_at: number;
}

interface RunLinkRow {
  run_id: string;
  schema_version: number;
  session_id: string;
  thread_id: string;
  task_id: string | null;
  created_at: number;
}

function _migrate(database: Database): void {
  database.run(`
    CREATE TABLE IF NOT EXISTS app_schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )
  `);
  const current =
    database
      .query<{ version: number | null }, []>(
        "SELECT MAX(version) AS version FROM app_schema_migrations"
      )
      .get()?.version ?? 0;
  if (current > SCHEMA_VERSION) {
    throw new Error(
      `Application database schema ${current} is newer than supported.`
    );
  }
  if (current === SCHEMA_VERSION) return;
  database.transaction(() => {
    database.run(`
      CREATE TABLE app_sessions (
        id TEXT PRIMARY KEY,
        schema_version INTEGER NOT NULL,
        project_id TEXT,
        thread_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        title TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
    database.run(`
      CREATE TABLE app_tasks (
        id TEXT PRIMARY KEY,
        schema_version INTEGER NOT NULL,
        session_id TEXT NOT NULL,
        title TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY(session_id) REFERENCES app_sessions(id)
      )
    `);
    database.run(`
      CREATE TABLE app_session_messages (
        id TEXT PRIMARY KEY,
        schema_version INTEGER NOT NULL,
        session_id TEXT NOT NULL,
        type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY(session_id) REFERENCES app_sessions(id)
      )
    `);
    database.run(`
      CREATE INDEX app_session_messages_timeline
      ON app_session_messages(session_id, created_at, id)
    `);
    database.run(`
      CREATE TABLE app_session_run_links (
        run_id TEXT PRIMARY KEY,
        schema_version INTEGER NOT NULL,
        session_id TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        task_id TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY(session_id) REFERENCES app_sessions(id),
        FOREIGN KEY(task_id) REFERENCES app_tasks(id)
      )
    `);
    database.run(`
      CREATE TABLE app_run_intents (
        operation_id TEXT PRIMARY KEY,
        schema_version INTEGER NOT NULL,
        session_id TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY(session_id) REFERENCES app_sessions(id)
      )
    `);
    database.run(
      "INSERT INTO app_schema_migrations (version, applied_at) VALUES (?, ?)",
      [SCHEMA_VERSION, Date.now()]
    );
  })();
}

function _session(row: SessionRow): Session {
  return {
    schemaVersion: 1,
    id: row.id,
    ...(row.project_id === null ? {} : { projectId: row.project_id }),
    threadId: row.thread_id,
    agentId: row.agent_id,
    title: row.title,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function _task(row: TaskRow): Task {
  return {
    schemaVersion: 1,
    id: row.id,
    sessionId: row.session_id,
    title: row.title,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function _runLink(row: RunLinkRow): SessionRunLink {
  return {
    schemaVersion: 1,
    sessionId: row.session_id,
    threadId: row.thread_id,
    runId: row.run_id,
    ...(row.task_id === null ? {} : { taskId: row.task_id }),
    createdAt: row.created_at,
  };
}

function _json(value: unknown): string {
  const encoded = JSON.stringify(value);
  if (encoded === undefined)
    throw new Error("Application Store value is not JSON serializable.");
  return encoded;
}

function _parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}
