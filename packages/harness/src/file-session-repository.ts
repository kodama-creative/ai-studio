import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { encodeSessionStorageKey } from "./encode-session-storage-key";
import { getFileErrorCode } from "./get-file-error-code";
import type { HarnessSessionSnapshot } from "./protocol";
import type { SessionRepository } from "./session-repository";
import { isStoredSessionSnapshot } from "./stored-session-snapshot";

export class FileSessionRepository implements SessionRepository {
  constructor(private readonly _root: string) {}

  async load(sessionId: string): Promise<HarnessSessionSnapshot | undefined> {
    const path = this._snapshotPath(sessionId);
    try {
      const value: unknown = JSON.parse(await readFile(path, "utf8"));
      if (!isStoredSessionSnapshot(value) || value.id !== sessionId) {
        throw new Error(`Invalid session snapshot in "${path}".`);
      }
      return value;
    } catch (error) {
      if (getFileErrorCode(error) === "ENOENT") return undefined;
      throw error;
    }
  }

  async save(snapshot: HarnessSessionSnapshot): Promise<void> {
    await mkdir(this._sessionsRoot(), { recursive: true, mode: 0o700 });
    const destination = this._snapshotPath(snapshot.id);
    const temporary = `${destination}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
      await rename(temporary, destination);
    } finally {
      await rm(temporary, { force: true });
    }
  }

  delete(sessionId: string): Promise<void> {
    return rm(this._snapshotPath(sessionId), { force: true });
  }

  private _sessionsRoot(): string {
    return join(this._root, "sessions");
  }

  private _snapshotPath(sessionId: string): string {
    return join(
      this._sessionsRoot(),
      `${encodeSessionStorageKey(sessionId)}.json`
    );
  }
}
