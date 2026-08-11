import type {
  ApplicationRunIntent,
  Session,
  SessionMessage,
  SessionRunLink,
  Task,
} from "../domain";

import type {
  ApplicationStore,
  ApplicationStoreTransaction,
} from "./application-store";

interface MemoryState {
  sessions: Map<string, Session>;
  tasks: Map<string, Task>;
  messages: Map<string, SessionMessage>;
  runLinks: Map<string, SessionRunLink>;
  runIntents: Map<string, ApplicationRunIntent>;
}

/** Transactional in-memory Adapter used by Application contract tests. */
export class InMemoryApplicationStore implements ApplicationStore {
  private _state: MemoryState = {
    sessions: new Map(),
    tasks: new Map(),
    messages: new Map(),
    runLinks: new Map(),
    runIntents: new Map(),
  };

  transaction<T>(fn: (tx: ApplicationStoreTransaction) => T): T {
    const next = structuredClone(this._state);
    const result = fn(new MemoryTransaction(next));
    this._state = next;
    return structuredClone(result);
  }

  close(): void {
    // The in-memory Adapter owns no external resources.
  }
}

class MemoryTransaction implements ApplicationStoreTransaction {
  constructor(private readonly _state: MemoryState) {}

  getSession(sessionId: string): Session | undefined {
    return _clone(this._state.sessions.get(sessionId));
  }

  listSessions(): readonly Session[] {
    return _values(this._state.sessions).toSorted(_byCreatedAt);
  }

  insertSession(session: Session): void {
    if (this._state.sessions.has(session.id)) {
      throw new Error(`Session "${session.id}" already exists.`);
    }
    this._state.sessions.set(session.id, structuredClone(session));
  }

  saveSession(session: Session): void {
    if (!this._state.sessions.has(session.id)) {
      throw new Error(`Session "${session.id}" was not found.`);
    }
    this._state.sessions.set(session.id, structuredClone(session));
  }

  getTask(taskId: string): Task | undefined {
    return _clone(this._state.tasks.get(taskId));
  }

  listTasks(sessionId: string): readonly Task[] {
    return _values(this._state.tasks)
      .filter((task) => task.sessionId === sessionId)
      .toSorted(_byCreatedAt);
  }

  insertTask(task: Task): void {
    if (this._state.tasks.has(task.id)) {
      throw new Error(`Task "${task.id}" already exists.`);
    }
    this._state.tasks.set(task.id, structuredClone(task));
  }

  saveTask(task: Task): void {
    if (!this._state.tasks.has(task.id)) {
      throw new Error(`Task "${task.id}" was not found.`);
    }
    this._state.tasks.set(task.id, structuredClone(task));
  }

  upsertSessionMessage(message: SessionMessage): "inserted" | "updated" {
    const current = this._state.messages.get(message.id);
    this._state.messages.set(
      message.id,
      structuredClone({
        ...message,
        createdAt: current?.createdAt ?? message.createdAt,
      })
    );
    return current === undefined ? "inserted" : "updated";
  }

  listSessionMessages(sessionId: string): readonly SessionMessage[] {
    return _values(this._state.messages)
      .filter((message) => message.sessionId === sessionId)
      .toSorted(_byCreatedAt);
  }

  insertRunLink(link: SessionRunLink): "inserted" | "existing" {
    if (this._state.runLinks.has(link.runId)) return "existing";
    this._state.runLinks.set(link.runId, structuredClone(link));
    return "inserted";
  }

  getRunLink(runId: string): SessionRunLink | undefined {
    return _clone(this._state.runLinks.get(runId));
  }

  listRunLinks(sessionId: string): readonly SessionRunLink[] {
    return _values(this._state.runLinks).filter(
      (link) => link.sessionId === sessionId
    );
  }

  getRunIntent(operationId: string): ApplicationRunIntent | undefined {
    return _clone(this._state.runIntents.get(operationId));
  }

  listRunIntents(): readonly ApplicationRunIntent[] {
    return _values(this._state.runIntents).toSorted(_byCreatedAt);
  }

  insertRunIntent(intent: ApplicationRunIntent): void {
    if (this._state.runIntents.has(intent.operationId)) {
      throw new Error(`Run intent "${intent.operationId}" already exists.`);
    }
    this._state.runIntents.set(intent.operationId, structuredClone(intent));
  }

  deleteRunIntent(operationId: string): void {
    this._state.runIntents.delete(operationId);
  }
}

function _values<T>(values: Map<string, T>): T[] {
  return [...values.values()].map((value) => structuredClone(value));
}

function _clone<T>(value: T | undefined): T | undefined {
  return value === undefined ? undefined : structuredClone(value);
}

function _byCreatedAt(
  left: { readonly createdAt: number },
  right: { readonly createdAt: number }
): number {
  return left.createdAt - right.createdAt;
}
