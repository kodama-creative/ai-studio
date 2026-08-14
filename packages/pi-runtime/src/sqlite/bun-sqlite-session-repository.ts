import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import {
  Session,
  SessionError,
  type BranchBounds,
  type Entry,
  type EntryQuery,
  type ForkOptions,
  type LaneRecord,
  type LogItem,
  type NewRecord,
  type OperationStartedRecord,
  type ProvisionedEntry,
  type RecordQuery,
  type SessionCreateOptions,
  type SessionMetadata,
  type SessionRepo,
  type SessionStats,
  type SessionStorage,
} from "@earendil-works/pi-agent-core";
import { uuidv7 } from "@earendil-works/pi-ai";
import { Database } from "bun:sqlite";

const SCHEMA_VERSION = 1;
const DEFAULT_LEASE_TTL_MS = 30_000;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 10_000;

export interface BunSqliteSessionRepositoryOptions {
  /** Existing Studio SQLite path; Pi owns only tables prefixed with `pi_`. */
  readonly path: string;
  readonly writerLease?: {
    readonly ttlMs?: number;
    readonly heartbeatIntervalMs?: number;
  };
}

interface WriterLease {
  readonly ownerId: string;
  readonly fence: number;
}

interface SessionRow {
  readonly id: string;
  readonly created_at: number;
  readonly parent_session_id: string | null;
  readonly next_seq: number;
}

interface EntryRow {
  readonly id: string;
  readonly seq: number;
  readonly parent_id: string | null;
  readonly type: Entry["type"];
  readonly timestamp: number;
  readonly payload_json: string;
}

interface RecordRow {
  readonly id: string;
  readonly seq: number;
  readonly lane: string;
  readonly type: LaneRecord["type"];
  readonly run_id: string | null;
  readonly operation_kind: string | null;
  readonly timestamp: number;
  readonly payload_json: string;
}

interface LaneRow {
  readonly lane: string;
  readonly leaf_id: string | null;
  readonly ordinal: number;
  readonly open_operation_id: string | null;
}

interface FactRow {
  readonly seq: number;
  readonly kind: "name" | "label";
  readonly target_id: string | null;
  readonly value_json: string | null;
}

/** Serializes asynchronous callers before they enter SQLite write transactions. */
class SerialOperationQueue {
  private _tail: Promise<void> = Promise.resolve();

  /** Admits one operation after prior work, preserving failures for its caller. */
  enqueue<T>(operation: () => T | Promise<T>): Promise<T> {
    const result = this._tail.then(operation);
    this._tail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  /** Waits until all work already admitted to the queue has settled. */
  drain(): Promise<void> {
    return this._tail;
  }
}

/**
 * Bun-native Pi Session repository over a host-owned SQLite file.
 *
 * It implements Pi's public repository contract without importing Pi internals.
 * Every mutation is fenced and receives one session-wide sequence number.
 */
export class BunSqliteSessionRepository
  implements SessionRepo, AsyncDisposable
{
  private readonly _database: Database;
  private readonly _operations = new SerialOperationQueue();
  private readonly _activeStorages = new Map<string, BunSqliteSessionStorage>();
  private readonly _leaseTtlMs: number;
  private readonly _heartbeatIntervalMs: number;
  private _closed = false;

  constructor(options: BunSqliteSessionRepositoryOptions) {
    this._leaseTtlMs = options.writerLease?.ttlMs ?? DEFAULT_LEASE_TTL_MS;
    this._heartbeatIntervalMs =
      options.writerLease?.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
    _validateLeaseOptions(this._leaseTtlMs, this._heartbeatIntervalMs);
    if (options.path !== ":memory:") {
      mkdirSync(dirname(options.path), { recursive: true, mode: 0o700 });
    }
    this._database = new Database(options.path, { create: true });
    this._database.run("PRAGMA foreign_keys = ON");
    this._database.run("PRAGMA busy_timeout = 5000");
    if (options.path !== ":memory:") {
      this._database.run("PRAGMA journal_mode = WAL");
      this._database.run("PRAGMA synchronous = NORMAL");
    }
    _migrate(this._database);
  }

  /** Creates and writer-claims a Session with an initial `main` lane. */
  create(options: SessionCreateOptions = {}): Promise<Session> {
    return this._operations.enqueue(() => {
      this._requireOpen();
      const id = options.id ?? uuidv7();
      const metadata: SessionMetadata = {
        id,
        createdAt: Date.now(),
        ...(options.parentSessionId === undefined
          ? {}
          : { parentSessionId: options.parentSessionId }),
      };
      const lease = this._database.transaction(() => {
        if (this._sessionRow(id) !== undefined) {
          throw new SessionError(
            "already_exists",
            `Session already exists: ${id}`
          );
        }
        this._database
          .query(
            `INSERT INTO pi_sessions
              (id, created_at, parent_session_id, next_seq)
             VALUES (?, ?, ?, 1)`
          )
          .run(id, metadata.createdAt, metadata.parentSessionId ?? null);
        this._database
          .query(
            `INSERT INTO pi_lanes
              (session_id, lane, leaf_id, ordinal, open_operation_id)
             VALUES (?, 'main', NULL, 0, NULL)`
          )
          .run(id);
        return this._claimWriter(id);
      })();
      return this._sessionFromLease(metadata, lease);
    });
  }

  /** Opens an existing Session and reuses this repository's active claim. */
  open(metadata: SessionMetadata): Promise<Session> {
    return this._operations.enqueue(() => {
      this._requireOpen();
      const row = this._requireSessionRow(metadata.id);
      const active = this._activeStorages.get(metadata.id);
      if (active !== undefined) return new Session(active);
      const lease = this._database.transaction(() =>
        this._claimWriter(metadata.id)
      )();
      return this._sessionFromLease(_metadata(row), lease);
    });
  }

  /** Lists metadata without acquiring writer leases. */
  list(): Promise<SessionMetadata[]> {
    return this._operations.enqueue(() => {
      this._requireOpen();
      return this._database
        .query<SessionRow, []>(
          `SELECT id, created_at, parent_session_id, next_seq
           FROM pi_sessions ORDER BY created_at, id`
        )
        .all()
        .map(_metadata);
    });
  }

  /** Deletes a Session idempotently after releasing this repository's claim. */
  delete(metadata: SessionMetadata): Promise<void> {
    return this._operations.enqueue(async () => {
      this._requireOpen();
      await this._releaseStorage(metadata.id);
      this._database.transaction(() => {
        this._database
          .query(`DELETE FROM pi_writer_leases WHERE session_id = ?`)
          .run(metadata.id);
        this._database
          .query(`DELETE FROM pi_sessions WHERE id = ?`)
          .run(metadata.id);
      })();
    });
  }

  /** Forks either the selected main branch or the complete entry tree. */
  fork(
    source: SessionMetadata,
    options: ForkOptions & SessionCreateOptions
  ): Promise<Session> {
    return this._operations.enqueue(() => {
      this._requireOpen();
      const sourceRow = this._requireSessionRow(source.id);
      const id = options.id ?? uuidv7();
      if (this._sessionRow(id) !== undefined) {
        throw new SessionError(
          "already_exists",
          `Session already exists: ${id}`
        );
      }
      const selected = this._selectFork(source.id, options);
      const metadata: SessionMetadata = {
        id,
        createdAt: Date.now(),
        parentSessionId: options.parentSessionId ?? sourceRow.id,
      };
      const lease = this._database.transaction(() => {
        this._database
          .query(
            `INSERT INTO pi_sessions
              (id, created_at, parent_session_id, next_seq)
             VALUES (?, ?, ?, ?)`
          )
          .run(id, metadata.createdAt, metadata.parentSessionId ?? null, 1);
        let sequence = 1;
        for (const entry of selected.entries) {
          this._database
            .query(
              `INSERT INTO pi_entries
                (session_id, id, seq, parent_id, type, timestamp, payload_json)
               VALUES (?, ?, ?, ?, ?, ?, ?)`
            )
            .run(
              id,
              entry.id,
              sequence,
              entry.parent_id,
              entry.type,
              entry.timestamp,
              _json({ ..._entry(entry), seq: sequence })
            );
          sequence += 1;
        }
        for (const [ordinal, lane] of selected.lanes.entries()) {
          this._database
            .query(
              `INSERT INTO pi_lanes
                (session_id, lane, leaf_id, ordinal, open_operation_id)
               VALUES (?, ?, ?, ?, NULL)`
            )
            .run(id, lane.lane, lane.leafId, ordinal);
          this._database
            .query(
              `INSERT INTO pi_lane_moves (session_id, seq, lane, leaf_id)
               VALUES (?, ?, ?, ?)`
            )
            .run(id, sequence, lane.lane, lane.leafId);
          sequence += 1;
        }
        for (const fact of selected.facts) {
          this._database
            .query(
              `INSERT INTO pi_facts
                (session_id, seq, kind, target_id, value_json)
               VALUES (?, ?, ?, ?, ?)`
            )
            .run(id, sequence, fact.kind, fact.target_id, fact.value_json);
          sequence += 1;
        }
        this._database
          .query(`UPDATE pi_sessions SET next_seq = ? WHERE id = ?`)
          .run(sequence, id);
        return this._claimWriter(id);
      })();
      return this._sessionFromLease(metadata, lease);
    });
  }

  /** Releases all writer claims and closes only this adapter's connection. */
  async close(): Promise<void> {
    if (this._closed) return;
    await this._operations.drain();
    for (const id of [...this._activeStorages.keys()]) {
      await this._releaseStorage(id);
    }
    this._closed = true;
    this._database.close();
  }

  /** Enables `await using` to release writer leases before closing SQLite. */
  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }

  /** Wraps one writer lease in Pi's public Session object and tracks release. */
  private _sessionFromLease(
    metadata: SessionMetadata,
    lease: WriterLease
  ): Session {
    const storage = new BunSqliteSessionStorage({
      database: this._database,
      metadata,
      lease,
      leaseTtlMs: this._leaseTtlMs,
      heartbeatIntervalMs: this._heartbeatIntervalMs,
      onRelease: () => this._activeStorages.delete(metadata.id),
    });
    this._activeStorages.set(metadata.id, storage);
    return new Session(storage);
  }

  /** Releases a cached storage instance without affecting other Sessions. */
  private async _releaseStorage(id: string): Promise<void> {
    await this._activeStorages.get(id)?.release();
  }

  /** Claims or takes over an expired writer lease and returns its fence token. */
  private _claimWriter(sessionId: string): WriterLease {
    const now = Date.now();
    const ownerId = uuidv7();
    const row = this._database
      .query<
        { owner_id: string; fence: number },
        [string, string, number, number]
      >(
        `INSERT INTO pi_writer_leases
          (session_id, owner_id, fence, expires_at_ms)
         VALUES (?, ?, 1, ?)
         ON CONFLICT(session_id) DO UPDATE SET
           owner_id = excluded.owner_id,
           fence = pi_writer_leases.fence + 1,
           expires_at_ms = excluded.expires_at_ms
         WHERE pi_writer_leases.expires_at_ms <= ?
         RETURNING owner_id, fence`
      )
      .get(sessionId, ownerId, now + this._leaseTtlMs, now);
    if (row === null) {
      throw new SessionError(
        "storage",
        `SQLite session ${sessionId} already has an active writer`
      );
    }
    return { ownerId: row.owner_id, fence: row.fence };
  }

  /** Reads raw repository metadata without claiming the Session for writing. */
  private _sessionRow(id: string): SessionRow | undefined {
    return (
      this._database
        .query<SessionRow, [string]>(
          `SELECT id, created_at, parent_session_id, next_seq
           FROM pi_sessions WHERE id = ?`
        )
        .get(id) ?? undefined
    );
  }

  /** Reads existing metadata or maps absence to Pi's `not_found` error. */
  private _requireSessionRow(id: string): SessionRow {
    const row = this._sessionRow(id);
    if (row === undefined) {
      throw new SessionError("not_found", `Session not found: ${id}`);
    }
    return row;
  }

  /** Selects and validates the exact tree/branch and facts copied by a fork. */
  private _selectFork(
    sessionId: string,
    options: ForkOptions
  ): {
    entries: EntryRow[];
    lanes: { lane: string; leafId: string | null }[];
    facts: FactRow[];
  } {
    const allEntries = this._entryRows(sessionId, "oldestFirst");
    const entriesById = new Map(allEntries.map((entry) => [entry.id, entry]));
    let entries: EntryRow[];
    let lanes: { lane: string; leafId: string | null }[];
    if (options.scope === "tree") {
      entries = allEntries;
      lanes = this._database
        .query<LaneRow, [string]>(
          `SELECT lane, leaf_id, ordinal, open_operation_id
           FROM pi_lanes WHERE session_id = ? ORDER BY ordinal`
        )
        .all(sessionId)
        .map((row) => ({ lane: row.lane, leafId: row.leaf_id }));
    } else {
      const main = this._database
        .query<LaneRow, [string]>(
          `SELECT lane, leaf_id, ordinal, open_operation_id
           FROM pi_lanes WHERE session_id = ? AND lane = 'main'`
        )
        .get(sessionId);
      if (main === null) {
        throw new SessionError("invalid_lane", "Lane not found: main");
      }
      const selectedId = options.entryId ?? main.leaf_id;
      let targetId: string | null = null;
      if (selectedId !== null) {
        const selectedEntry = entriesById.get(selectedId);
        if (selectedEntry?.type !== "message") {
          throw new SessionError(
            "invalid_fork_target",
            `Fork target is not a message entry: ${selectedId}`
          );
        }
        const position =
          options.position ?? (options.entryId === undefined ? "at" : "before");
        targetId =
          position === "at" ? selectedEntry.id : selectedEntry.parent_id;
      }
      entries = _walkRows(entriesById, targetId).reverse();
      lanes = [{ lane: "main", leafId: targetId }];
    }
    const copiedIds = new Set(entries.map((entry) => entry.id));
    const facts = this._latestFacts(sessionId).filter(
      (fact) =>
        fact.kind === "name" ||
        (fact.target_id !== null && copiedIds.has(fact.target_id))
    );
    return { entries, lanes, facts };
  }

  /** Reads all entries in stable session-sequence order for fork selection. */
  private _entryRows(
    sessionId: string,
    order: "newestFirst" | "oldestFirst"
  ): EntryRow[] {
    return this._database
      .query<EntryRow, [string]>(
        `SELECT id, seq, parent_id, type, timestamp, payload_json
         FROM pi_entries WHERE session_id = ?
         ORDER BY seq ${order === "oldestFirst" ? "ASC" : "DESC"}`
      )
      .all(sessionId);
  }

  /** Reduces append-only fact rows to their latest non-deleted values. */
  private _latestFacts(sessionId: string): FactRow[] {
    const rows = this._database
      .query<FactRow, [string]>(
        `SELECT seq, kind, target_id, value_json
         FROM pi_facts WHERE session_id = ? ORDER BY seq DESC`
      )
      .all(sessionId);
    const selected = new Map<string, FactRow>();
    for (const row of rows) {
      const key = `${row.kind}:${row.target_id ?? ""}`;
      if (!selected.has(key)) selected.set(key, row);
    }
    return [...selected.values()].filter((row) => row.value_json !== null);
  }

  /** Rejects repository operations after its SQLite connection is closed. */
  private _requireOpen(): void {
    if (this._closed) {
      throw new SessionError("storage", "SQLite Session repository is closed");
    }
  }
}

class BunSqliteSessionStorage implements SessionStorage {
  private readonly _database: Database;
  private readonly _metadata: SessionMetadata;
  private readonly _lease: WriterLease;
  private readonly _leaseTtlMs: number;
  private readonly _operations = new SerialOperationQueue();
  private readonly _onRelease: () => void;
  private readonly _heartbeat: Timer;
  private _closed = false;
  private _leaseLost = false;

  constructor(options: {
    database: Database;
    metadata: SessionMetadata;
    lease: WriterLease;
    leaseTtlMs: number;
    heartbeatIntervalMs: number;
    onRelease: () => void;
  }) {
    this._database = options.database;
    this._metadata = structuredClone(options.metadata);
    this._lease = options.lease;
    this._leaseTtlMs = options.leaseTtlMs;
    this._onRelease = options.onRelease;
    this._heartbeat = setInterval(
      () => this._renewHeartbeat(),
      options.heartbeatIntervalMs
    );
    this._heartbeat.unref();
  }

  /** Stops heartbeats and releases this exact owner/fence pair. */
  async release(): Promise<void> {
    if (this._closed) return;
    this._closed = true;
    clearInterval(this._heartbeat);
    await this._operations.drain();
    this._database
      .query(
        `DELETE FROM pi_writer_leases
         WHERE session_id = ? AND owner_id = ? AND fence = ?`
      )
      .run(this._metadata.id, this._lease.ownerId, this._lease.fence);
    this._onRelease();
  }

  /** Returns fresh metadata and fails if the Session was externally deleted. */
  getMetadata(): Promise<SessionMetadata> {
    const row = this._requireSessionRow();
    return Promise.resolve(_metadata(row));
  }

  /** Lists durable lane pointers in creation order without caching leaf ids. */
  getLanes(): Promise<{ lane: string; leafId: string | null }[]> {
    return Promise.resolve(
      this._database
        .query<LaneRow, [string]>(
          `SELECT lane, leaf_id, ordinal, open_operation_id
           FROM pi_lanes WHERE session_id = ? ORDER BY ordinal`
        )
        .all(this._metadata.id)
        .map((row) => ({ lane: row.lane, leafId: row.leaf_id }))
    );
  }

  /** Creates a lane and commits its initial pointer as one fenced mutation. */
  createLane(lane: string, at: string | null): Promise<void> {
    return this._write(() => {
      if (this._lane(lane) !== undefined) {
        throw new SessionError(
          "already_exists",
          `Lane already exists: ${lane}`
        );
      }
      this._validateTarget(at);
      const seq = this._nextSequence();
      const ordinal =
        this._database
          .query<{ count: number }, [string]>(
            `SELECT COUNT(*) AS count FROM pi_lanes WHERE session_id = ?`
          )
          .get(this._metadata.id)?.count ?? 0;
      this._database
        .query(
          `INSERT INTO pi_lanes
            (session_id, lane, leaf_id, ordinal, open_operation_id)
           VALUES (?, ?, ?, ?, NULL)`
        )
        .run(this._metadata.id, lane, at, ordinal);
      this._appendLaneMove(seq, lane, at);
      this._advanceSequence(seq);
    });
  }

  /** Moves a lane pointer and appends the corresponding ordered log item. */
  moveLane(lane: string, to: string | null): Promise<void> {
    return this._write(() => {
      this._requireLane(lane);
      this._validateTarget(to);
      const seq = this._nextSequence();
      this._database
        .query(
          `UPDATE pi_lanes SET leaf_id = ?
           WHERE session_id = ? AND lane = ?`
        )
        .run(to, this._metadata.id, lane);
      this._appendLaneMove(seq, lane, to);
      this._advanceSequence(seq);
    });
  }

  /** Materializes a provisioned entry at the lane leaf and advances the leaf. */
  appendEntry<TEntry extends Entry>(
    entry: ProvisionedEntry<TEntry>,
    lane: string
  ): Promise<TEntry> {
    return this._write(() => {
      const parentId = this._requireLane(lane).leaf_id;
      this._assertUnusedId(entry.id);
      const seq = this._nextSequence();
      const committed = {
        ...structuredClone(entry),
        parentId,
        seq,
        timestamp: Date.now(),
      } as unknown as TEntry;
      this._database
        .query(
          `INSERT INTO pi_entries
            (session_id, id, seq, parent_id, type, timestamp, payload_json)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          this._metadata.id,
          committed.id,
          committed.seq,
          committed.parentId,
          committed.type,
          committed.timestamp,
          _json(committed)
        );
      this._database
        .query(
          `UPDATE pi_lanes SET leaf_id = ?
           WHERE session_id = ? AND lane = ?`
        )
        .run(committed.id, this._metadata.id, lane);
      this._advanceSequence(seq);
      return structuredClone(committed);
    });
  }

  /** Appends one recovery record and maintains the open-operation index. */
  appendRecord<TRecord extends LaneRecord>(
    record: NewRecord<TRecord>
  ): Promise<TRecord> {
    return this._write(() => {
      const lane = this._requireLane(record.lane);
      this._assertUnusedId(record.id);
      if (
        record.type === "operation_started" &&
        lane.open_operation_id !== null
      ) {
        throw new SessionError(
          "storage",
          `Lane ${record.lane} already has an open operation ${lane.open_operation_id}`
        );
      }
      const seq = this._nextSequence();
      const committed = {
        ...structuredClone(record),
        seq,
        timestamp: Date.now(),
      } as unknown as TRecord;
      this._database
        .query(
          `INSERT INTO pi_records
            (session_id, id, seq, lane, type, run_id, operation_kind,
             timestamp, payload_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          this._metadata.id,
          committed.id,
          committed.seq,
          committed.lane,
          committed.type,
          _recordRunId(record),
          record.type === "operation_started" ? record.intent.kind : null,
          committed.timestamp,
          _json(committed)
        );
      if (record.type === "operation_started") {
        this._database
          .query(
            `UPDATE pi_lanes SET open_operation_id = ?
             WHERE session_id = ? AND lane = ?`
          )
          .run(record.id, this._metadata.id, record.lane);
      } else if (record.type === "operation_finished") {
        this._database
          .query(
            `UPDATE pi_lanes SET open_operation_id = NULL
             WHERE session_id = ? AND lane = ? AND open_operation_id = ?`
          )
          .run(this._metadata.id, record.lane, record.runId);
      }
      this._advanceSequence(seq);
      return structuredClone(committed);
    });
  }

  /** Reads one immutable entry by its Session-wide id. */
  getEntry(id: string): Promise<Entry | undefined> {
    const row = this._entryRow(id);
    return Promise.resolve(row === undefined ? undefined : _entry(row));
  }

  /** Queries immutable entries using Pi's type/cursor/order contract. */
  findEntries(query: EntryQuery = {}): Promise<Entry[]> {
    const entries = this._entryRows(query.order).map(_entry);
    return Promise.resolve(
      _limit(
        entries.filter((entry) => _matchesEntry(entry, query)),
        query.limit
      )
    );
  }

  /** Walks parent links from an explicit start and applies branch bounds. */
  findEntriesOnBranch(
    query: EntryQuery & BranchBounds & { start: string }
  ): Promise<Entry[]> {
    const entries = this._entryRows("oldestFirst");
    const byId = new Map(entries.map((entry) => [entry.id, entry]));
    let branch = _walkRows(byId, query.start);
    if (query.order === "oldestFirst") branch = branch.reverse();
    const selected: Entry[] = [];
    for (const row of branch) {
      const entry = _entry(row);
      const reachedBound =
        entry.id === query.stopAtId || entry.type === query.stopAtType;
      if (_matchesEntry(entry, query)) selected.push(entry);
      if (reachedBound || selected.length === query.limit) break;
    }
    return Promise.resolve(selected);
  }

  /** Queries immutable recovery records using Pi's public filters. */
  findRecords(query: RecordQuery = {}): Promise<LaneRecord[]> {
    let records = this._recordRows(query.order).map(_record);
    records = records.filter((record) => _matchesRecord(record, query));
    return Promise.resolve(_limit(records, query.limit));
  }

  /** Finds starts without a later finish; recovery intentionally asks for two. */
  findOpenOperations(
    lane: string,
    options?: { limit?: number }
  ): Promise<OperationStartedRecord[]> {
    const records = this._recordRows("newestFirst").map(_record);
    const latestFinishSequence = new Map<string, number>();
    for (const record of records) {
      if (
        record.type === "operation_finished" &&
        !latestFinishSequence.has(record.runId)
      ) {
        latestFinishSequence.set(record.runId, record.seq);
      }
    }
    const open = records.filter(
      (record): record is OperationStartedRecord =>
        record.type === "operation_started" &&
        record.lane === lane &&
        (latestFinishSequence.get(record.id) ?? -1) < record.seq
    );
    return Promise.resolve(_limit(open, options?.limit));
  }

  /** Merges entries, records, lane moves, and facts by one global sequence. */
  getLog(
    options: { afterSeq?: number; limit?: number } = {}
  ): Promise<LogItem[]> {
    const entries = this._entryRows("oldestFirst").map((row) => ({
      kind: "entry" as const,
      seq: row.seq,
      entry: _entry(row),
    }));
    const records = this._recordRows("oldestFirst").map((row) => ({
      kind: "record" as const,
      seq: row.seq,
      record: _record(row),
    }));
    const lanes = this._database
      .query<{ seq: number; lane: string; leaf_id: string | null }, [string]>(
        `SELECT seq, lane, leaf_id FROM pi_lane_moves
         WHERE session_id = ? ORDER BY seq`
      )
      .all(this._metadata.id)
      .map((row) => ({
        kind: "lane" as const,
        seq: row.seq,
        lane: row.lane,
        leafId: row.leaf_id,
      }));
    const facts = this._database
      .query<FactRow, [string]>(
        `SELECT seq, kind, target_id, value_json FROM pi_facts
         WHERE session_id = ? ORDER BY seq`
      )
      .all(this._metadata.id)
      .map(_factLogItem);
    const log = [...entries, ...records, ...lanes, ...facts]
      .sort((left, right) => left.seq - right.seq)
      .filter(
        (item) => options.afterSeq === undefined || item.seq > options.afterSeq
      );
    return Promise.resolve(_limit(log, options.limit));
  }

  /** Returns the latest non-deleted Session name fact. */
  getName(): Promise<string | undefined> {
    return Promise.resolve(this._fact("name", null));
  }

  /** Appends a new name fact rather than mutating historical state. */
  setName(name: string): Promise<void> {
    return this._write(() => this._appendFact("name", null, name));
  }

  /** Returns the latest non-deleted label for a durable entry. */
  getLabel(id: string): Promise<string | undefined> {
    return Promise.resolve(this._fact("label", id));
  }

  /** Appends or tombstones an entry label after validating its target. */
  setLabel(id: string, label: string | undefined): Promise<void> {
    return this._write(() => {
      this._validateTarget(id);
      this._appendFact("label", id, label);
    });
  }

  /** Aggregates message counts and durable usage without replaying the log. */
  getStats(): Promise<SessionStats> {
    const messageCount =
      this._database
        .query<{ count: number }, [string]>(
          `SELECT COUNT(*) AS count FROM pi_entries
           WHERE session_id = ? AND type = 'message'`
        )
        .get(this._metadata.id)?.count ?? 0;
    const usage = this._recordRows("oldestFirst")
      .map(_record)
      .filter((record) => record.type === "usage")
      .map((record) => record.usage);
    return Promise.resolve({
      messageCount,
      cachedTokens: usage.reduce((sum, item) => sum + item.cacheRead, 0),
      uncachedTokens: usage.reduce(
        (sum, item) => sum + item.input + item.cacheWrite,
        0
      ),
      totalTokens: usage.reduce((sum, item) => sum + item.totalTokens, 0),
      costTotal: usage.reduce((sum, item) => sum + item.cost.total, 0),
    });
  }

  /** Serializes one transaction and renews the exact writer fence first. */
  private _write<T>(operation: () => T): Promise<T> {
    if (this._closed) {
      return Promise.reject(
        new SessionError(
          "storage",
          `SQLite session ${this._metadata.id} is closed`
        )
      );
    }
    return this._operations.enqueue(() =>
      this._database.transaction(() => {
        this._renewLeaseOrThrow();
        return operation();
      })()
    );
  }

  /** Best-effort heartbeat; lost ownership is surfaced by the next write. */
  private _renewHeartbeat(): void {
    if (this._closed || this._leaseLost) return;
    void this._operations.enqueue(() => {
      if (this._closed || this._leaseLost) return;
      try {
        this._database.transaction(() => this._renewLeaseOrThrow())();
      } catch {
        // The next write reports the durable lost-lease fault to its caller.
      }
    });
  }

  /** Renews only this owner/fence pair or permanently marks the lease lost. */
  private _renewLeaseOrThrow(): void {
    if (this._leaseLost) this._throwLostLease();
    const now = Date.now();
    const result = this._database
      .query(
        `UPDATE pi_writer_leases SET expires_at_ms = ?
         WHERE session_id = ? AND owner_id = ? AND fence = ?
           AND expires_at_ms > ?`
      )
      .run(
        now + this._leaseTtlMs,
        this._metadata.id,
        this._lease.ownerId,
        this._lease.fence,
        now
      );
    if (result.changes !== 1) {
      this._leaseLost = true;
      this._throwLostLease();
    }
  }

  /** Converts lost writer ownership into a non-recoverable storage error. */
  private _throwLostLease(): never {
    throw new SessionError(
      "storage",
      `SQLite session ${this._metadata.id} writer lease was lost`
    );
  }

  /** Reads current sequence metadata so stale/deleted Sessions fail closed. */
  private _requireSessionRow(): SessionRow {
    const row = this._database
      .query<SessionRow, [string]>(
        `SELECT id, created_at, parent_session_id, next_seq
         FROM pi_sessions WHERE id = ?`
      )
      .get(this._metadata.id);
    if (row === null) {
      throw new SessionError(
        "not_found",
        `Session not found: ${this._metadata.id}`
      );
    }
    return row;
  }

  /** Reads one lane pointer without throwing for optional existence checks. */
  private _lane(lane: string): LaneRow | undefined {
    return (
      this._database
        .query<LaneRow, [string, string]>(
          `SELECT lane, leaf_id, ordinal, open_operation_id
           FROM pi_lanes WHERE session_id = ? AND lane = ?`
        )
        .get(this._metadata.id, lane) ?? undefined
    );
  }

  /** Resolves an existing lane or maps absence to Pi's invalid-lane error. */
  private _requireLane(lane: string): LaneRow {
    const row = this._lane(lane);
    if (row === undefined) {
      throw new SessionError("invalid_lane", `Lane not found: ${lane}`);
    }
    return row;
  }

  /** Reads one raw entry row scoped to this Session. */
  private _entryRow(id: string): EntryRow | undefined {
    return (
      this._database
        .query<EntryRow, [string, string]>(
          `SELECT id, seq, parent_id, type, timestamp, payload_json
           FROM pi_entries WHERE session_id = ? AND id = ?`
        )
        .get(this._metadata.id, id) ?? undefined
    );
  }

  /** Reads all raw entries in deterministic sequence order. */
  private _entryRows(
    order: "newestFirst" | "oldestFirst" = "newestFirst"
  ): EntryRow[] {
    return this._database
      .query<EntryRow, [string]>(
        `SELECT id, seq, parent_id, type, timestamp, payload_json
         FROM pi_entries WHERE session_id = ?
         ORDER BY seq ${order === "oldestFirst" ? "ASC" : "DESC"}`
      )
      .all(this._metadata.id);
  }

  /** Reads all raw records in deterministic sequence order. */
  private _recordRows(
    order: "newestFirst" | "oldestFirst" = "newestFirst"
  ): RecordRow[] {
    return this._database
      .query<RecordRow, [string]>(
        `SELECT id, seq, lane, type, run_id, operation_kind, timestamp,
                payload_json
         FROM pi_records WHERE session_id = ?
         ORDER BY seq ${order === "oldestFirst" ? "ASC" : "DESC"}`
      )
      .all(this._metadata.id);
  }

  /** Ensures a lane/fork pointer targets an entry in this Session. */
  private _validateTarget(id: string | null): void {
    if (id !== null && this._entryRow(id) === undefined) {
      throw new SessionError("not_found", `Entry not found: ${id}`);
    }
  }

  /** Enforces the Session-wide id namespace shared by entries and records. */
  private _assertUnusedId(id: string): void {
    const entry = this._entryRow(id);
    const record = this._database
      .query<{ present: number }, [string, string]>(
        `SELECT 1 AS present FROM pi_records
         WHERE session_id = ? AND id = ?`
      )
      .get(this._metadata.id, id);
    if (entry !== undefined || record !== null) {
      throw new SessionError(
        "already_exists",
        `Session id already exists: ${id}`
      );
    }
  }

  /** Reads the next sequence while verifying the Session still exists. */
  private _nextSequence(): number {
    return this._requireSessionRow().next_seq;
  }

  /** Advances the sequence with compare-and-set to detect concurrent writers. */
  private _advanceSequence(committed: number): void {
    const result = this._database
      .query(
        `UPDATE pi_sessions SET next_seq = ?
         WHERE id = ? AND next_seq = ?`
      )
      .run(committed + 1, this._metadata.id, committed);
    if (result.changes !== 1) {
      throw new SessionError(
        "storage",
        `Session ${this._metadata.id} sequence changed concurrently`
      );
    }
  }

  /** Persists a lane move under the already-reserved mutation sequence. */
  private _appendLaneMove(
    seq: number,
    lane: string,
    leafId: string | null
  ): void {
    this._database
      .query(
        `INSERT INTO pi_lane_moves (session_id, seq, lane, leaf_id)
         VALUES (?, ?, ?, ?)`
      )
      .run(this._metadata.id, seq, lane, leafId);
  }

  /** Appends an immutable fact row; undefined is represented as a tombstone. */
  private _appendFact(
    kind: "name" | "label",
    targetId: string | null,
    value: string | undefined
  ): void {
    const seq = this._nextSequence();
    this._database
      .query(
        `INSERT INTO pi_facts
          (session_id, seq, kind, target_id, value_json)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        this._metadata.id,
        seq,
        kind,
        targetId,
        value === undefined ? null : _json(value)
      );
    this._advanceSequence(seq);
  }

  /** Reads the latest fact value, treating a tombstone as absent. */
  private _fact(
    kind: "name" | "label",
    targetId: string | null
  ): string | undefined {
    const row = this._database
      .query<{ value_json: string | null }, [string, string, string | null]>(
        `SELECT value_json FROM pi_facts
         WHERE session_id = ? AND kind = ? AND target_id IS ?
         ORDER BY seq DESC LIMIT 1`
      )
      .get(this._metadata.id, kind, targetId);
    return row?.value_json === undefined || row.value_json === null
      ? undefined
      : (JSON.parse(row.value_json) as string);
  }
}

/** Rejects lease timings that cannot renew strictly before writer ownership expires. */
function _validateLeaseOptions(ttlMs: number, heartbeatMs: number): void {
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) {
    throw new RangeError("writerLease.ttlMs must be positive");
  }
  if (
    !Number.isSafeInteger(heartbeatMs) ||
    heartbeatMs <= 0 ||
    heartbeatMs >= ttlMs
  ) {
    throw new RangeError(
      "writerLease.heartbeatIntervalMs must be positive and less than ttlMs"
    );
  }
}

/** Converts the private SQLite row shape to Pi's public Session metadata. */
function _metadata(row: SessionRow): SessionMetadata {
  return {
    id: row.id,
    createdAt: row.created_at,
    ...(row.parent_session_id === null
      ? {}
      : { parentSessionId: row.parent_session_id }),
  };
}

/** Rehydrates and clones one immutable entry so callers cannot mutate stored state. */
function _entry(row: EntryRow): Entry {
  return structuredClone(JSON.parse(row.payload_json) as Entry);
}

/** Rehydrates and clones one immutable recovery record. */
function _record(row: RecordRow): LaneRecord {
  return structuredClone(JSON.parse(row.payload_json) as LaneRecord);
}

/** Extracts the operation identity denormalized into the record query index. */
function _recordRunId(record: NewRecord): string | null {
  if (record.type === "operation_started") return record.id;
  return "runId" in record ? (record.runId ?? null) : null;
}

/** Applies the in-memory entry predicates after branch selection and ordering. */
function _matchesEntry(entry: Entry, query: EntryQuery): boolean {
  return (
    (query.type === undefined || entry.type === query.type) &&
    (query.customType === undefined ||
      (entry.type === "custom" && entry.customType === query.customType)) &&
    (query.cursor === undefined ||
      (query.order === "oldestFirst"
        ? entry.seq > query.cursor.afterSeq
        : entry.seq < query.cursor.afterSeq))
  );
}

/** Applies record filters whose union-specific fields are not safe to express generically in SQL. */
function _matchesRecord(record: LaneRecord, query: RecordQuery): boolean {
  return (
    (query.lane === undefined || record.lane === query.lane) &&
    (query.type === undefined || record.type === query.type) &&
    (query.runId === undefined ||
      (record.type === "operation_started"
        ? record.id === query.runId
        : "runId" in record && record.runId === query.runId)) &&
    (query.operationKind === undefined ||
      (record.type === "operation_started" &&
        record.intent.kind === query.operationKind)) &&
    (query.afterSeq === undefined || record.seq > query.afterSeq)
  );
}

/**
 * Walks one immutable entry branch from its leaf to the root.
 * Missing parents and cycles are rejected because either would make replay
 * order ambiguous; callers reverse the result when they need oldest-first.
 */
function _walkRows(
  byId: ReadonlyMap<string, EntryRow>,
  start: string | null
): EntryRow[] {
  if (start === null) return [];
  const rows: EntryRow[] = [];
  const visited = new Set<string>();
  let current = byId.get(start);
  if (current === undefined) {
    throw new SessionError("not_found", `Entry not found: ${start}`);
  }
  while (current !== undefined) {
    if (visited.has(current.id)) {
      throw new SessionError(
        "invalid_entry",
        `Session branch contains a cycle at ${current.id}`
      );
    }
    visited.add(current.id);
    rows.push(current);
    if (current.parent_id === null) break;
    const parentId = current.parent_id;
    current = byId.get(parentId);
    if (current === undefined) {
      throw new SessionError("invalid_entry", `Entry not found: ${parentId}`);
    }
  }
  return rows;
}

/** Projects a name/label fact row into Pi's merged chronological log shape. */
function _factLogItem(row: FactRow): LogItem {
  if (row.kind === "name") {
    return {
      kind: "fact",
      seq: row.seq,
      fact: "name",
      name: JSON.parse(row.value_json ?? '""') as string,
    };
  }
  return {
    kind: "fact",
    seq: row.seq,
    fact: "label",
    targetId: row.target_id ?? "",
    label:
      row.value_json === null
        ? undefined
        : (JSON.parse(row.value_json) as string),
  };
}

/** Applies Pi's optional result cap after semantic ordering and filtering. */
function _limit<T>(values: T[], limit: number | undefined): T[] {
  return limit === undefined ? values : values.slice(0, limit);
}

/** Encodes already-validated Pi payloads for immutable SQLite storage. */
function _json(value: unknown): string {
  return JSON.stringify(value);
}

/**
 * Creates the Pi-owned schema atomically in a host-provided SQLite database.
 * Every object remains under the `pi_` namespace so Studio and Pi can safely
 * share one physical database without sharing table ownership.
 */
function _migrate(database: Database): void {
  database.transaction(() => {
    database.run(`
      CREATE TABLE IF NOT EXISTS pi_schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      ) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS pi_sessions (
        id TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        parent_session_id TEXT NULL,
        next_seq INTEGER NOT NULL
      ) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS pi_entries (
        session_id TEXT NOT NULL REFERENCES pi_sessions(id) ON DELETE CASCADE,
        id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        parent_id TEXT NULL,
        type TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        payload_json TEXT NOT NULL,
        PRIMARY KEY (session_id, id),
        UNIQUE (session_id, seq)
      ) WITHOUT ROWID;
      CREATE INDEX IF NOT EXISTS pi_entries_session_seq
        ON pi_entries(session_id, seq);
      CREATE TABLE IF NOT EXISTS pi_records (
        session_id TEXT NOT NULL REFERENCES pi_sessions(id) ON DELETE CASCADE,
        id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        lane TEXT NOT NULL,
        type TEXT NOT NULL,
        run_id TEXT NULL,
        operation_kind TEXT NULL,
        timestamp INTEGER NOT NULL,
        payload_json TEXT NOT NULL,
        PRIMARY KEY (session_id, id),
        UNIQUE (session_id, seq)
      ) WITHOUT ROWID;
      CREATE INDEX IF NOT EXISTS pi_records_session_seq
        ON pi_records(session_id, seq);
      CREATE INDEX IF NOT EXISTS pi_records_session_lane_type_seq
        ON pi_records(session_id, lane, type, seq);
      CREATE TABLE IF NOT EXISTS pi_lanes (
        session_id TEXT NOT NULL REFERENCES pi_sessions(id) ON DELETE CASCADE,
        lane TEXT NOT NULL,
        leaf_id TEXT NULL,
        ordinal INTEGER NOT NULL,
        open_operation_id TEXT NULL,
        PRIMARY KEY (session_id, lane),
        UNIQUE (session_id, ordinal)
      ) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS pi_lane_moves (
        session_id TEXT NOT NULL REFERENCES pi_sessions(id) ON DELETE CASCADE,
        seq INTEGER NOT NULL,
        lane TEXT NOT NULL,
        leaf_id TEXT NULL,
        PRIMARY KEY (session_id, seq)
      ) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS pi_facts (
        session_id TEXT NOT NULL REFERENCES pi_sessions(id) ON DELETE CASCADE,
        seq INTEGER NOT NULL,
        kind TEXT NOT NULL,
        target_id TEXT NULL,
        value_json TEXT NULL,
        PRIMARY KEY (session_id, seq)
      ) WITHOUT ROWID;
      CREATE INDEX IF NOT EXISTS pi_facts_latest
        ON pi_facts(session_id, kind, target_id, seq DESC);
      CREATE TABLE IF NOT EXISTS pi_writer_leases (
        session_id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        fence INTEGER NOT NULL,
        expires_at_ms INTEGER NOT NULL
      ) WITHOUT ROWID;
    `);
    database
      .query(
        `INSERT OR IGNORE INTO pi_schema_migrations (version, applied_at)
         VALUES (?, ?)`
      )
      .run(SCHEMA_VERSION, Date.now());
  })();
}
