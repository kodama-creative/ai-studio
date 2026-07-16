import { randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import path from "node:path";

const CREDENTIAL_FILE_VERSION = 1;

export interface LocalServerCredential {
  readonly artifactFingerprint: string;
  readonly continuationToken: string;
  readonly expiresAt: string;
  readonly projectId: string;
  readonly sessionId: string;
  readonly threadId: string;
}

interface LocalServerCredentialFile {
  readonly version: typeof CREDENTIAL_FILE_VERSION;
  readonly entries: readonly LocalServerCredential[];
}

/** Bun-only raw continuation credential registry. */
export class LocalServerCredentialStore {
  private readonly _directory: string;
  private readonly _file: string;
  private _entries: Map<string, LocalServerCredential> | null = null;
  private _writeTail: Promise<void> = Promise.resolve();

  constructor(homePath: string) {
    this._directory = path.join(homePath, "credentials");
    this._file = path.join(this._directory, "local-server.json");
  }

  async get(
    projectId: string,
    threadId: string
  ): Promise<LocalServerCredential | null> {
    await this._load();
    return this._entries?.get(_key(projectId, threadId)) ?? null;
  }

  async set(credential: LocalServerCredential): Promise<void> {
    _assertCredential(credential);
    await this._mutate(entries => {
      entries.set(_key(credential.projectId, credential.threadId), {
        ...credential
      });
    });
  }

  async delete(
    projectId: string,
    threadId: string
  ): Promise<LocalServerCredential | null> {
    let removed: LocalServerCredential | null = null;
    await this._mutate(entries => {
      const key = _key(projectId, threadId);
      removed = entries.get(key) ?? null;
      entries.delete(key);
    });
    return removed;
  }

  private async _load(): Promise<void> {
    if (this._entries) {
      return;
    }
    await mkdir(this._directory, { recursive: true, mode: 0o700 });
    await chmod(this._directory, 0o700);
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(this._file, "utf8")) as unknown;
    } catch (error) {
      if (_hasCode(error, "ENOENT")) {
        this._entries = new Map();
        return;
      }
      throw new Error("Local Server credential registry is unreadable.", {
        cause: error
      });
    }
    const file = _credentialFile(parsed);
    this._entries = new Map(
      file.entries.map(entry => [_key(entry.projectId, entry.threadId), entry])
    );
    await chmod(this._file, 0o600);
  }

  private async _mutate(
    update: (entries: Map<string, LocalServerCredential>) => void
  ): Promise<void> {
    const operation = this._writeTail.then(async () => {
      await this._load();
      const entries = new Map(this._entries);
      update(entries);
      await this._write(entries);
      this._entries = entries;
    });
    this._writeTail = operation.catch(() => {});
    return operation;
  }

  private async _write(
    entries: ReadonlyMap<string, LocalServerCredential>
  ): Promise<void> {
    await mkdir(this._directory, { recursive: true, mode: 0o700 });
    await chmod(this._directory, 0o700);
    const temporary = path.join(
      this._directory,
      `.local-server-${randomUUID()}.tmp`
    );
    const file: LocalServerCredentialFile = {
      version: CREDENTIAL_FILE_VERSION,
      entries: [...entries.values()].toSorted((left, right) =>
        _key(left.projectId, left.threadId).localeCompare(
          _key(right.projectId, right.threadId)
        ))
    };
    try {
      await writeFile(temporary, `${JSON.stringify(file, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600
      });
      await rename(temporary, this._file);
      await chmod(this._file, 0o600);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => {});
      throw error;
    }
  }
}

function _credentialFile(value: unknown): LocalServerCredentialFile {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Local Server credential registry has an invalid shape.");
  }
  const record = value as Record<string, unknown>;
  if (record.version !== CREDENTIAL_FILE_VERSION || !Array.isArray(record.entries)) {
    throw new Error("Local Server credential registry has an unsupported version.");
  }
  const entries = record.entries.map(entry => {
    _assertCredential(entry);
    return { ...entry };
  });
  const keys = entries.map(entry => _key(entry.projectId, entry.threadId));
  if (new Set(keys).size !== keys.length) {
    throw new Error("Local Server credential registry contains duplicate Threads.");
  }
  return { version: CREDENTIAL_FILE_VERSION, entries };
}

function _assertCredential(value: unknown): asserts value is LocalServerCredential {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Local Server credential entry is invalid.");
  }
  const record = value as Record<string, unknown>;
  for (const key of [
    "artifactFingerprint",
    "continuationToken",
    "expiresAt",
    "projectId",
    "sessionId",
    "threadId"
  ]) {
    if (typeof record[key] !== "string" || !record[key].trim()) {
      throw new Error("Local Server credential entry is incomplete.");
    }
  }
  if (!Number.isFinite(Date.parse(record.expiresAt as string))) {
    throw new Error("Local Server credential expiry is invalid.");
  }
}

function _key(projectId: string, threadId: string): string {
  return `${projectId}\u0000${threadId}`;
}

function _hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
