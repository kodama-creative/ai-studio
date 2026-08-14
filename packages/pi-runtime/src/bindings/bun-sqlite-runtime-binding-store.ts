import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { Database } from "bun:sqlite";

export interface RuntimeBinding {
  formatVersion: number;
  agent: {
    agentSpecId: string;
    projectId?: string;
    sourceRevision: string;
  };
  model: {
    provider: string;
    modelId: string;
    thinkingLevel?: string;
  };
  systemPrompt: string;
  tools: {
    name: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
    outputSchema?: Record<string, unknown>;
    implementationId: string;
    replay: "never" | "safe";
    hostBinding?: Record<string, unknown>;
  }[];
}

export interface RuntimeBindingReference {
  bindingId: string;
  bindingHash: string;
  formatVersion: number;
}

export class RuntimeBindingConflictError extends Error {
  constructor(readonly bindingId: string) {
    super(`Runtime binding "${bindingId}" already has different content.`);
    this.name = "RuntimeBindingConflictError";
  }
}

export class RuntimeBindingResolutionError extends Error {
  constructor(
    readonly code: "missing" | "hash_mismatch" | "format_mismatch",
    readonly bindingId: string
  ) {
    super(`Runtime binding "${bindingId}" could not be resolved: ${code}.`);
    this.name = "RuntimeBindingResolutionError";
  }
}

/** Stores LLM Space runtime snapshots next to, but outside, Pi-owned tables. */
export class BunSqliteRuntimeBindingStore {
  private readonly _database: Database;

  constructor(options: { readonly path: string }) {
    if (options.path !== ":memory:") {
      mkdirSync(dirname(options.path), { recursive: true, mode: 0o700 });
    }
    this._database = new Database(options.path, { create: true });
    this._database.run("PRAGMA busy_timeout = 5000");
    if (options.path !== ":memory:") {
      this._database.run("PRAGMA journal_mode = WAL");
      this._database.run("PRAGMA synchronous = NORMAL");
    }
    this._database.run(`
      CREATE TABLE IF NOT EXISTS llm_space_runtime_bindings (
        id TEXT PRIMARY KEY,
        binding_hash TEXT NOT NULL,
        format_version INTEGER NOT NULL,
        binding_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      ) WITHOUT ROWID
    `);
  }

  /** Commits immutable content before the operation that references it. */
  put(input: {
    readonly id: string;
    readonly binding: RuntimeBinding;
  }): RuntimeBindingReference {
    const bindingJson = _canonicalJson(input.binding);
    const bindingHash = _sha256(bindingJson);
    const existing = this._database
      .query<
        { binding_hash: string; format_version: number; binding_json: string },
        [string]
      >(
        `SELECT binding_hash, format_version, binding_json
         FROM llm_space_runtime_bindings WHERE id = ?`
      )
      .get(input.id);
    if (existing !== null) {
      if (
        existing.binding_hash !== bindingHash ||
        existing.binding_json !== bindingJson ||
        existing.format_version !== input.binding.formatVersion
      ) {
        throw new RuntimeBindingConflictError(input.id);
      }
      return {
        bindingId: input.id,
        bindingHash,
        formatVersion: input.binding.formatVersion,
      };
    }
    this._database
      .query(
        `INSERT INTO llm_space_runtime_bindings
          (id, binding_hash, format_version, binding_json, created_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        input.id,
        bindingHash,
        input.binding.formatVersion,
        bindingJson,
        Date.now()
      );
    return {
      bindingId: input.id,
      bindingHash,
      formatVersion: input.binding.formatVersion,
    };
  }

  /** Resolves and verifies the exact snapshot referenced by Pi resume data. */
  resolve(reference: RuntimeBindingReference): RuntimeBinding {
    const row = this._database
      .query<
        { binding_hash: string; format_version: number; binding_json: string },
        [string]
      >(
        `SELECT binding_hash, format_version, binding_json
         FROM llm_space_runtime_bindings WHERE id = ?`
      )
      .get(reference.bindingId);
    if (row === null) {
      throw new RuntimeBindingResolutionError("missing", reference.bindingId);
    }
    if (
      row.binding_hash !== reference.bindingHash ||
      _sha256(row.binding_json) !== reference.bindingHash
    ) {
      throw new RuntimeBindingResolutionError(
        "hash_mismatch",
        reference.bindingId
      );
    }
    if (
      row.format_version !== reference.formatVersion ||
      row.format_version !==
        (JSON.parse(row.binding_json) as RuntimeBinding).formatVersion
    ) {
      throw new RuntimeBindingResolutionError(
        "format_mismatch",
        reference.bindingId
      );
    }
    return structuredClone(JSON.parse(row.binding_json) as RuntimeBinding);
  }

  /** Closes only this binding-store connection; the shared database remains. */
  close(): void {
    this._database.close();
  }
}

/** Serializes binding content deterministically so identity is independent of key order. */
function _canonicalJson(value: unknown): string {
  return JSON.stringify(_sortJson(value));
}

/** Recursively normalizes JSON objects and omits values JSON would not persist. */
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

/** Computes the content address persisted and later rechecked during resolution. */
function _sha256(value: string): string {
  return new Bun.CryptoHasher("sha256").update(value).digest("hex");
}
