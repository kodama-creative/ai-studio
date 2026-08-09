import type { HarnessSessionSnapshot } from "./protocol";
import type { SessionRepository } from "./session-repository";

export class InMemorySessionRepository implements SessionRepository {
  private readonly _snapshots = new Map<string, HarnessSessionSnapshot>();

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
