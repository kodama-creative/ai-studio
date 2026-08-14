import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { Database } from "bun:sqlite";

import type {
  AppCommandReceipt,
  AppSessionRecord,
  Task,
} from "../../domain";
import type {
  ApplicationStore,
  ApplicationStoreTransaction,
} from "../application-store";

export interface CreateSqliteApplicationStoreOptions {
  readonly path: string;
}

/** Opens App-owned metadata tables in the same SQLite file as Pi Session. */
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
    _createSchema(this._database);
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

  getSession(sessionId: string): AppSessionRecord | undefined {
    return this._read<AppSessionRecord>(
      "SELECT payload_json FROM app_sessions WHERE session_id = ?",
      sessionId
    );
  }

  listSessions(): readonly AppSessionRecord[] {
    return this._database
      .query<{ payload_json: string }, []>(
        "SELECT payload_json FROM app_sessions ORDER BY created_at, session_id"
      )
      .all()
      .map((row) => _parse(row.payload_json));
  }

  insertSession(session: AppSessionRecord): void {
    this._database
      .query(
        `INSERT INTO app_sessions (
          session_id, schema_version, payload_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        session.sessionId,
        session.schemaVersion,
        _json(session),
        session.createdAt,
        session.updatedAt
      );
  }

  saveSession(session: AppSessionRecord): void {
    const result = this._database
      .query(
        `UPDATE app_sessions SET payload_json = ?, updated_at = ?
         WHERE session_id = ?`
      )
      .run(_json(session), session.updatedAt, session.sessionId);
    if (result.changes !== 1) {
      throw new Error(`Session "${session.sessionId}" was not found.`);
    }
  }

  getTask(taskId: string): Task | undefined {
    return this._read<Task>(
      "SELECT payload_json FROM app_tasks WHERE id = ?",
      taskId
    );
  }

  listTasks(sessionId: string): readonly Task[] {
    return this._database
      .query<{ payload_json: string }, [string]>(
        `SELECT payload_json FROM app_tasks
         WHERE session_id = ? ORDER BY created_at, id`
      )
      .all(sessionId)
      .map((row) => _parse(row.payload_json));
  }

  insertTask(task: Task): void {
    this._database
      .query(
        `INSERT INTO app_tasks (
          id, schema_version, session_id, payload_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        task.id,
        task.schemaVersion,
        task.sessionId,
        _json(task),
        task.createdAt,
        task.updatedAt
      );
  }

  saveTask(task: Task): void {
    const result = this._database
      .query(
        `UPDATE app_tasks SET payload_json = ?, updated_at = ? WHERE id = ?`
      )
      .run(_json(task), task.updatedAt, task.id);
    if (result.changes !== 1) {
      throw new Error(`Task "${task.id}" was not found.`);
    }
  }

  getCommandReceipt(
    sessionId: string,
    commandId: string
  ): AppCommandReceipt | undefined {
    const row = this._database
      .query<{ payload_json: string }, [string, string]>(
        `SELECT payload_json FROM app_command_receipts
         WHERE session_id = ? AND command_id = ?`
      )
      .get(sessionId, commandId);
    return row === null ? undefined : _parse(row.payload_json);
  }

  insertCommandReceipt(receipt: AppCommandReceipt): void {
    this._database
      .query(
        `INSERT INTO app_command_receipts (
          session_id, command_id, method, fingerprint, payload_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        receipt.sessionId,
        receipt.commandId,
        receipt.method,
        receipt.fingerprint,
        _json(receipt),
        receipt.createdAt
      );
  }

  saveCommandReceipt(receipt: AppCommandReceipt): void {
    const result = this._database
      .query(
        `UPDATE app_command_receipts SET
          method = ?, fingerprint = ?, payload_json = ?
         WHERE session_id = ? AND command_id = ?`
      )
      .run(
        receipt.method,
        receipt.fingerprint,
        _json(receipt),
        receipt.sessionId,
        receipt.commandId
      );
    if (result.changes !== 1) {
      throw new Error(`Command "${receipt.commandId}" was not found.`);
    }
  }

  private _read<T>(query: string, value: string): T | undefined {
    const row = this._database
      .query<{ payload_json: string }, [string]>(query)
      .get(value);
    return row === null ? undefined : _parse(row.payload_json);
  }
}

/** Creates only the current App-owned tables; legacy schemas are unsupported. */
function _createSchema(database: Database): void {
  database.transaction(() => {
    database.run(`
      CREATE TABLE IF NOT EXISTS app_sessions (
        session_id TEXT PRIMARY KEY,
        schema_version INTEGER NOT NULL,
        payload_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
    database.run(`
      CREATE TABLE IF NOT EXISTS app_tasks (
        id TEXT PRIMARY KEY,
        schema_version INTEGER NOT NULL,
        session_id TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY(session_id) REFERENCES app_sessions(session_id)
      )
    `);
    database.run(`
      CREATE TABLE IF NOT EXISTS app_command_receipts (
        session_id TEXT NOT NULL,
        command_id TEXT NOT NULL,
        method TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY(session_id, command_id),
        FOREIGN KEY(session_id) REFERENCES app_sessions(session_id)
      )
    `);
  })();
}

function _json(value: unknown): string {
  return JSON.stringify(value);
}

function _parse<T>(value: string): T {
  return JSON.parse(value) as T;
}
