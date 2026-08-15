import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { Database } from "bun:sqlite";

import type {
  StudioExperimentRecord,
  StudioThreadEvent,
  ThreadRunReference,
} from "../../domain";
import type { Evaluation, EvaluationRubric } from "../../evaluation";
import type { PlaygroundRecord } from "../../playground";
import type {
  StudioCommandReceipt,
  StudioStore,
  StudioStoreTransaction,
} from "../studio-store";

const SCHEMA_VERSION = 5;

export interface CreateSqliteStudioStoreOptions {
  readonly path: string;
}

/** Creates the SQLite Adapter for Studio-owned experiment and evaluation data. */
export function createSqliteStudioStore(
  options: CreateSqliteStudioStoreOptions
): StudioStore {
  if (options.path !== ":memory:") {
    mkdirSync(dirname(options.path), { recursive: true, mode: 0o700 });
  }
  return new SqliteStudioStore(new Database(options.path, { create: true }));
}

class SqliteStudioStore implements StudioStore {
  constructor(private readonly _database: Database) {
    this._database.run("PRAGMA foreign_keys = ON");
    this._database.run("PRAGMA busy_timeout = 5000");
    if (this._database.filename !== ":memory:") {
      this._database.run("PRAGMA journal_mode = WAL");
      this._database.run("PRAGMA synchronous = NORMAL");
    }
    _migrate(this._database);
  }

  transaction<T>(fn: (tx: StudioStoreTransaction) => T): T {
    return this._database.transaction(() =>
      fn(new SqliteTransaction(this._database))
    )();
  }

  close(): void {
    this._database.close();
  }
}

class SqliteTransaction implements StudioStoreTransaction {
  constructor(private readonly _database: Database) {}

  getPlayground(playgroundId: string): PlaygroundRecord | undefined {
    const row = this._database
      .query<{ payload_json: string }, [string]>(
        "SELECT payload_json FROM studio_playgrounds WHERE id = ?"
      )
      .get(playgroundId);
    return row === null ? undefined : _parse(row.payload_json);
  }

  listPlaygrounds(): readonly PlaygroundRecord[] {
    return this._database
      .query<{ payload_json: string }, []>(
        "SELECT payload_json FROM studio_playgrounds ORDER BY updated_at DESC, id"
      )
      .all()
      .map((row) => _parse(row.payload_json));
  }

  insertPlayground(playground: PlaygroundRecord): void {
    this._database
      .query(
        `INSERT INTO studio_playgrounds (
          id, schema_version, session_id, payload_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        playground.id,
        playground.schemaVersion,
        playground.sessionId,
        _json(playground),
        playground.createdAt,
        playground.updatedAt
      );
  }

  savePlayground(playground: PlaygroundRecord): void {
    const result = this._database
      .query(
        `UPDATE studio_playgrounds SET
          session_id = ?, payload_json = ?, updated_at = ?
        WHERE id = ?`
      )
      .run(
        playground.sessionId,
        _json(playground),
        playground.updatedAt,
        playground.id
      );
    if (result.changes !== 1) {
      throw new Error(`Playground "${playground.id}" was not found.`);
    }
  }

  getCommandReceipt(
    sessionId: string,
    commandId: string
  ): StudioCommandReceipt | undefined {
    const row = this._database
      .query<{ payload_json: string }, [string, string]>(
        `SELECT payload_json FROM studio_command_receipts
         WHERE session_id = ? AND command_id = ?`
      )
      .get(sessionId, commandId);
    return row === null ? undefined : _parse(row.payload_json);
  }

  insertCommandReceipt(receipt: StudioCommandReceipt): void {
    this._database
      .query(
        `INSERT INTO studio_command_receipts (
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

  getExperiment(experimentId: string): StudioExperimentRecord | undefined {
    const row = this._database
      .query<{ payload_json: string }, [string]>(
        "SELECT payload_json FROM studio_experiments WHERE id = ?"
      )
      .get(experimentId);
    return row === null ? undefined : _parse(row.payload_json);
  }

  listExperiments(): readonly StudioExperimentRecord[] {
    return this._database
      .query<{ payload_json: string }, []>(
        "SELECT payload_json FROM studio_experiments ORDER BY updated_at DESC, id"
      )
      .all()
      .map((row) => _parse(row.payload_json));
  }

  insertExperiment(experiment: StudioExperimentRecord): void {
    this._database
      .query(
        `INSERT INTO studio_experiments (
          id, schema_version, session_id, payload_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        experiment.id,
        experiment.schemaVersion,
        experiment.sessionId,
        _json(experiment),
        experiment.createdAt,
        experiment.updatedAt
      );
  }

  saveExperiment(experiment: StudioExperimentRecord): void {
    const result = this._database
      .query(
        `UPDATE studio_experiments SET
          session_id = ?, payload_json = ?, updated_at = ?
        WHERE id = ?`
      )
      .run(
        experiment.sessionId,
        _json(experiment),
        experiment.updatedAt,
        experiment.id
      );
    if (result.changes !== 1) {
      throw new Error(`Studio Experiment "${experiment.id}" was not found.`);
    }
  }

  listOperationReferences(experimentId: string): readonly ThreadRunReference[] {
    return this._database
      .query<{ payload_json: string }, [string]>(
        `SELECT payload_json FROM studio_operation_references
         WHERE experiment_id = ? ORDER BY position`
      )
      .all(experimentId)
      .map((row) => _parse(row.payload_json));
  }

  replaceOperationReferences(
    experimentId: string,
    references: readonly ThreadRunReference[]
  ): void {
    this._database
      .query("DELETE FROM studio_operation_references WHERE experiment_id = ?")
      .run(experimentId);
    const insert = this._database.query(
      `INSERT INTO studio_operation_references (
        experiment_id, operation_id, position, payload_json
      ) VALUES (?, ?, ?, ?)`
    );
    references.forEach((reference, position) => {
      insert.run(
        experimentId,
        reference.operationId,
        position,
        _json(reference)
      );
    });
  }

  listEvaluations(experimentId: string): readonly Evaluation[] {
    return this._listResources<Evaluation>("studio_evaluations", experimentId);
  }

  replaceEvaluations(
    experimentId: string,
    evaluations: readonly Evaluation[]
  ): void {
    this._replaceResources("studio_evaluations", experimentId, evaluations);
  }

  listRubrics(experimentId: string): readonly EvaluationRubric[] {
    return this._listResources<EvaluationRubric>(
      "studio_rubrics",
      experimentId
    );
  }

  replaceRubrics(
    experimentId: string,
    rubrics: readonly EvaluationRubric[]
  ): void {
    this._replaceResources("studio_rubrics", experimentId, rubrics);
  }

  appendEvent(event: Omit<StudioThreadEvent, "sequence">): StudioThreadEvent {
    const sequence =
      this._database
        .query<{ sequence: number | null }, [string]>(
          "SELECT MAX(sequence) AS sequence FROM studio_events WHERE experiment_id = ?"
        )
        .get(event.threadId)?.sequence ?? 0;
    const stored: StudioThreadEvent = { ...event, sequence: sequence + 1 };
    this._database
      .query(
        `INSERT INTO studio_events (
          experiment_id, sequence, timestamp, payload_json
        ) VALUES (?, ?, ?, ?)`
      )
      .run(stored.threadId, stored.sequence, stored.timestamp, _json(stored));
    return stored;
  }

  listEvents(
    experimentId: string,
    afterSequence: number
  ): readonly StudioThreadEvent[] {
    return this._database
      .query<{ payload_json: string }, [string, number]>(
        `SELECT payload_json FROM studio_events
         WHERE experiment_id = ? AND sequence > ? ORDER BY sequence`
      )
      .all(experimentId, afterSequence)
      .map((row) => _parse(row.payload_json));
  }

  private _listResources<T>(table: string, experimentId: string): readonly T[] {
    return this._database
      .query<{ payload_json: string }, [string]>(
        `SELECT payload_json FROM ${table} WHERE experiment_id = ? ORDER BY position`
      )
      .all(experimentId)
      .map((row) => _parse(row.payload_json));
  }

  private _replaceResources(
    table: "studio_evaluations" | "studio_rubrics",
    experimentId: string,
    resources: readonly { readonly id: string }[]
  ): void {
    this._database
      .query(`DELETE FROM ${table} WHERE experiment_id = ?`)
      .run(experimentId);
    const insert = this._database.query(
      `INSERT INTO ${table} (
        experiment_id, resource_id, position, payload_json
      ) VALUES (?, ?, ?, ?)`
    );
    resources.forEach((resource, position) => {
      insert.run(experimentId, resource.id, position, _json(resource));
    });
  }
}

function _migrate(database: Database): void {
  database.run(`
    CREATE TABLE IF NOT EXISTS studio_schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )
  `);
  const current =
    database
      .query<{ version: number | null }, []>(
        "SELECT MAX(version) AS version FROM studio_schema_migrations"
      )
      .get()?.version ?? 0;
  if (current > SCHEMA_VERSION) {
    throw new Error(
      `Studio database schema ${current} is newer than supported.`
    );
  }
  if (current === SCHEMA_VERSION) return;
  if (current !== 0) {
    throw new Error(
      `Studio database schema ${current} requires an explicit migration to ${SCHEMA_VERSION}.`
    );
  }
  const existingTables = database
    .query<{ name: string }, []>(
      `SELECT name FROM sqlite_master
       WHERE type = 'table'
         AND name LIKE 'studio_%'
         AND name <> 'studio_schema_migrations'
       ORDER BY name`
    )
    .all()
    .map((row) => row.name);
  if (existingTables.length > 0) {
    throw new Error(
      `Studio database has unversioned tables and requires an explicit migration: ${existingTables.join(", ")}.`
    );
  }
  database.transaction(() => {
    database.run(`
      CREATE TABLE studio_experiments (
        id TEXT PRIMARY KEY,
        schema_version INTEGER NOT NULL,
        session_id TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
    database.run(`
      CREATE TABLE studio_operation_references (
        experiment_id TEXT NOT NULL,
        operation_id TEXT NOT NULL,
        position INTEGER NOT NULL,
        payload_json TEXT NOT NULL,
        PRIMARY KEY(experiment_id, operation_id),
        UNIQUE(experiment_id, position),
        FOREIGN KEY(experiment_id) REFERENCES studio_experiments(id)
      )
    `);
    for (const table of ["studio_evaluations", "studio_rubrics"]) {
      database.run(`
        CREATE TABLE ${table} (
          experiment_id TEXT NOT NULL,
          resource_id TEXT NOT NULL,
          position INTEGER NOT NULL,
          payload_json TEXT NOT NULL,
          PRIMARY KEY(experiment_id, resource_id),
          UNIQUE(experiment_id, position),
          FOREIGN KEY(experiment_id) REFERENCES studio_experiments(id)
        )
      `);
    }
    database.run(`
      CREATE TABLE studio_events (
        experiment_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        timestamp INTEGER NOT NULL,
        payload_json TEXT NOT NULL,
        PRIMARY KEY(experiment_id, sequence),
        FOREIGN KEY(experiment_id) REFERENCES studio_experiments(id)
      )
    `);
    database.run(`
      CREATE TABLE studio_command_receipts (
        session_id TEXT NOT NULL,
        command_id TEXT NOT NULL,
        method TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY(session_id, command_id)
      )
    `);
    database.run(`
      CREATE TABLE studio_playgrounds (
        id TEXT PRIMARY KEY,
        schema_version INTEGER NOT NULL,
        session_id TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
    database.run(
      "INSERT INTO studio_schema_migrations (version, applied_at) VALUES (?, ?)",
      [SCHEMA_VERSION, Date.now()]
    );
  })();
}

function _json(value: unknown): string {
  const encoded = JSON.stringify(value);
  if (encoded === undefined)
    throw new Error("Studio Store value is not JSON serializable.");
  return encoded;
}

function _parse<T>(value: string): T {
  return JSON.parse(value) as T;
}
