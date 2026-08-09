import type { HarnessSessionSnapshot } from "../session/protocol";

import type { SessionRepository } from "./session-repository";

export class InMemorySessionRepository implements SessionRepository {
  private readonly _snapshots = new Map<string, HarnessSessionSnapshot>();

  create(snapshot: HarnessSessionSnapshot): Promise<"created" | "existing"> {
    if (this._snapshots.has(snapshot.id)) return Promise.resolve("existing");
    this._snapshots.set(snapshot.id, structuredClone(snapshot));
    return Promise.resolve("created");
  }

  load(sessionId: string): Promise<HarnessSessionSnapshot | undefined> {
    const snapshot = this._snapshots.get(sessionId);
    return Promise.resolve(
      snapshot === undefined ? undefined : structuredClone(snapshot)
    );
  }

  save(snapshot: HarnessSessionSnapshot): Promise<void> {
    this._snapshots.set(snapshot.id, structuredClone(snapshot));
    return Promise.resolve();
  }

  delete(sessionId: string): Promise<void> {
    this._snapshots.delete(sessionId);
    return Promise.resolve();
  }
}
