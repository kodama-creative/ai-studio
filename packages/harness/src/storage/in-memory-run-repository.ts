import type { Run, RunOwner, RunRepository } from "../run";

export class InMemoryRunRepository implements RunRepository {
  private readonly _runs = new Map<string, Run>();

  create(run: Run): Promise<"created" | "existing"> {
    if (this._runs.has(run.id)) return Promise.resolve("existing");
    this._runs.set(run.id, structuredClone(run));
    return Promise.resolve("created");
  }

  load(runId: string): Promise<Run | undefined> {
    const run = this._runs.get(runId);
    return Promise.resolve(
      run === undefined ? undefined : structuredClone(run)
    );
  }

  save(run: Run): Promise<void> {
    this._runs.set(run.id, structuredClone(run));
    return Promise.resolve();
  }

  listByOwner(owner: RunOwner): Promise<readonly Run[]> {
    return Promise.resolve(
      [...this._runs.values()]
        .filter((run) => _sameOwner(run.owner, owner))
        .map((run) => structuredClone(run))
    );
  }
}

function _sameOwner(left: RunOwner, right: RunOwner): boolean {
  return left.type === "session"
    ? right.type === "session" && left.sessionId === right.sessionId
    : right.type === "thread" && left.threadId === right.threadId;
}
