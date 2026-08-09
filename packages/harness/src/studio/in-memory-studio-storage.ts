import { InMemoryEvaluationRepository } from "../storage/in-memory-evaluation-repository";
import { InMemoryEvaluationRubricRepository } from "../storage/in-memory-evaluation-rubric-repository";
import { InMemoryRunRepository } from "../storage/in-memory-run-repository";

import type {
  StudioEventCursor,
  StudioStorage,
  StudioThreadEvent,
  StudioThreadEventLog,
  StudioThreadRepository,
  ThreadCheckpointRepository,
  ThreadRunIndexRepository,
  ThreadRunReference,
} from "./studio-repositories";
import type { StudioThread } from "./studio-thread";
import type { ThreadCheckpoint } from "./thread-checkpoint";

class InMemoryStudioThreadRepository implements StudioThreadRepository {
  private readonly _threads = new Map<string, StudioThread>();

  create(thread: StudioThread): Promise<"created" | "existing"> {
    if (this._threads.has(thread.id)) return Promise.resolve("existing");
    this._threads.set(thread.id, structuredClone(thread));
    return Promise.resolve("created");
  }

  load(threadId: string): Promise<StudioThread | undefined> {
    const thread = this._threads.get(threadId);
    return Promise.resolve(
      thread === undefined ? undefined : structuredClone(thread)
    );
  }

  save(thread: StudioThread): Promise<void> {
    this._threads.set(thread.id, structuredClone(thread));
    return Promise.resolve();
  }

  list(): Promise<readonly StudioThread[]> {
    return Promise.resolve(
      [...this._threads.values()].map((thread) => structuredClone(thread))
    );
  }
}

class InMemoryCheckpointRepository implements ThreadCheckpointRepository {
  private readonly _checkpoints = new Map<string, ThreadCheckpoint>();

  create(checkpoint: ThreadCheckpoint): Promise<"created" | "existing"> {
    if (this._checkpoints.has(checkpoint.id))
      return Promise.resolve("existing");
    this._checkpoints.set(checkpoint.id, structuredClone(checkpoint));
    return Promise.resolve("created");
  }

  load(checkpointId: string): Promise<ThreadCheckpoint | undefined> {
    const checkpoint = this._checkpoints.get(checkpointId);
    return Promise.resolve(
      checkpoint === undefined ? undefined : structuredClone(checkpoint)
    );
  }

  listByThread(threadId: string): Promise<readonly ThreadCheckpoint[]> {
    return Promise.resolve(
      [...this._checkpoints.values()]
        .filter((checkpoint) => checkpoint.threadId === threadId)
        .map((checkpoint) => structuredClone(checkpoint))
    );
  }
}

class InMemoryThreadRunIndexRepository implements ThreadRunIndexRepository {
  private readonly _references = new Map<string, ThreadRunReference[]>();

  append(reference: ThreadRunReference): Promise<void> {
    const references = this._references.get(reference.threadId) ?? [];
    references.push(structuredClone(reference));
    this._references.set(reference.threadId, references);
    return Promise.resolve();
  }

  replace(
    threadId: string,
    references: readonly ThreadRunReference[]
  ): Promise<void> {
    this._references.set(
      threadId,
      references.map((reference) => structuredClone(reference))
    );
    return Promise.resolve();
  }

  list(threadId: string): Promise<readonly ThreadRunReference[]> {
    return Promise.resolve(
      (this._references.get(threadId) ?? []).map((reference) =>
        structuredClone(reference)
      )
    );
  }
}

class InMemoryStudioThreadEventLog implements StudioThreadEventLog {
  private readonly _events = new Map<string, StudioThreadEvent[]>();
  private readonly _waiters = new Map<string, Set<() => void>>();

  append(event: StudioThreadEvent): Promise<void> {
    const events = this._events.get(event.threadId) ?? [];
    events.push(structuredClone(event));
    this._events.set(event.threadId, events);
    const waiters = this._waiters.get(event.threadId);
    if (waiters !== undefined) {
      this._waiters.delete(event.threadId);
      for (const wake of waiters) wake();
    }
    return Promise.resolve();
  }

  async *read(
    threadId: string,
    cursor: StudioEventCursor = {}
  ): AsyncIterable<StudioThreadEvent> {
    let afterSequence = cursor.afterSequence ?? 0;
    while (!cursor.signal?.aborted) {
      for (const event of this._events.get(threadId) ?? []) {
        if (event.sequence <= afterSequence) continue;
        afterSequence = event.sequence;
        yield structuredClone(event);
      }
      if (cursor.follow !== true) return;
      await this._waitForAppend(threadId, afterSequence, cursor.signal);
    }
  }

  private _waitForAppend(
    threadId: string,
    afterSequence: number,
    signal: AbortSignal | undefined
  ): Promise<void> {
    if (this._latestSequence(threadId) > afterSequence)
      return Promise.resolve();
    return new Promise((resolve) => {
      let waiters = this._waiters.get(threadId);
      if (waiters === undefined) {
        waiters = new Set();
        this._waiters.set(threadId, waiters);
      }
      const wake = () => {
        signal?.removeEventListener("abort", wake);
        waiters?.delete(wake);
        resolve();
      };
      waiters.add(wake);
      signal?.addEventListener("abort", wake, { once: true });
      if (this._latestSequence(threadId) > afterSequence) wake();
    });
  }

  private _latestSequence(threadId: string): number {
    return this._events.get(threadId)?.at(-1)?.sequence ?? 0;
  }
}

export function createInMemoryStudioStorage(): StudioStorage {
  return {
    threadRepository: new InMemoryStudioThreadRepository(),
    runRepository: new InMemoryRunRepository(),
    evaluationRepository: new InMemoryEvaluationRepository(),
    evaluationRubricRepository: new InMemoryEvaluationRubricRepository(),
    checkpointRepository: new InMemoryCheckpointRepository(),
    runIndexRepository: new InMemoryThreadRunIndexRepository(),
    eventLog: new InMemoryStudioThreadEventLog(),
  };
}
