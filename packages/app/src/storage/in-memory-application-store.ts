import type {
  AppCommandReceipt,
  AppSessionRecord,
  Task,
} from "../domain";

import type {
  ApplicationStore,
  ApplicationStoreTransaction,
} from "./application-store";

/** In-memory product metadata adapter used by App contract tests. */
export class InMemoryApplicationStore implements ApplicationStore {
  private readonly _sessions = new Map<string, AppSessionRecord>();
  private readonly _tasks = new Map<string, Task>();
  private readonly _receipts = new Map<string, AppCommandReceipt>();

  transaction<T>(fn: (tx: ApplicationStoreTransaction) => T): T {
    const sessions = structuredClone(this._sessions);
    const tasks = structuredClone(this._tasks);
    const receipts = structuredClone(this._receipts);
    try {
      return fn(this);
    } catch (error) {
      this._sessions.clear();
      this._tasks.clear();
      this._receipts.clear();
      for (const [key, value] of sessions) this._sessions.set(key, value);
      for (const [key, value] of tasks) this._tasks.set(key, value);
      for (const [key, value] of receipts) this._receipts.set(key, value);
      throw error;
    }
  }

  getSession(sessionId: string): AppSessionRecord | undefined {
    return _clone(this._sessions.get(sessionId));
  }

  listSessions(): readonly AppSessionRecord[] {
    return [...this._sessions.values()]
      .sort((left, right) => left.createdAt - right.createdAt)
      .map((session) => structuredClone(session));
  }

  insertSession(session: AppSessionRecord): void {
    if (this._sessions.has(session.sessionId)) {
      throw new Error(`Session "${session.sessionId}" already exists.`);
    }
    this._sessions.set(session.sessionId, structuredClone(session));
  }

  saveSession(session: AppSessionRecord): void {
    if (!this._sessions.has(session.sessionId)) {
      throw new Error(`Session "${session.sessionId}" was not found.`);
    }
    this._sessions.set(session.sessionId, structuredClone(session));
  }

  getTask(taskId: string): Task | undefined {
    return _clone(this._tasks.get(taskId));
  }

  listTasks(sessionId: string): readonly Task[] {
    return [...this._tasks.values()]
      .filter((task) => task.sessionId === sessionId)
      .sort((left, right) => left.createdAt - right.createdAt)
      .map((task) => structuredClone(task));
  }

  insertTask(task: Task): void {
    if (this._tasks.has(task.id)) {
      throw new Error(`Task "${task.id}" already exists.`);
    }
    this._tasks.set(task.id, structuredClone(task));
  }

  saveTask(task: Task): void {
    if (!this._tasks.has(task.id)) {
      throw new Error(`Task "${task.id}" was not found.`);
    }
    this._tasks.set(task.id, structuredClone(task));
  }

  getCommandReceipt(
    sessionId: string,
    commandId: string
  ): AppCommandReceipt | undefined {
    return _clone(this._receipts.get(_receiptKey(sessionId, commandId)));
  }

  insertCommandReceipt(receipt: AppCommandReceipt): void {
    const key = _receiptKey(receipt.sessionId, receipt.commandId);
    if (this._receipts.has(key)) {
      throw new Error(`Command "${receipt.commandId}" already exists.`);
    }
    this._receipts.set(key, structuredClone(receipt));
  }

  saveCommandReceipt(receipt: AppCommandReceipt): void {
    const key = _receiptKey(receipt.sessionId, receipt.commandId);
    if (!this._receipts.has(key)) {
      throw new Error(`Command "${receipt.commandId}" was not found.`);
    }
    this._receipts.set(key, structuredClone(receipt));
  }

  close(): void {
    // In-memory metadata owns no external resources.
  }
}

function _receiptKey(sessionId: string, commandId: string): string {
  return `${sessionId}\0${commandId}`;
}

function _clone<T>(value: T | undefined): T | undefined {
  return value === undefined ? undefined : structuredClone(value);
}
