import type {
  AppCommandReceipt,
  AppSessionRecord,
  Task,
} from "../domain";

export interface ApplicationStoreTransaction {
  getSession(sessionId: string): AppSessionRecord | undefined;
  listSessions(): readonly AppSessionRecord[];
  insertSession(session: AppSessionRecord): void;
  saveSession(session: AppSessionRecord): void;

  getTask(taskId: string): Task | undefined;
  listTasks(sessionId: string): readonly Task[];
  insertTask(task: Task): void;
  saveTask(task: Task): void;

  getCommandReceipt(
    sessionId: string,
    commandId: string
  ): AppCommandReceipt | undefined;
  insertCommandReceipt(receipt: AppCommandReceipt): void;
  saveCommandReceipt(receipt: AppCommandReceipt): void;
}

/** App persistence owns product metadata only, never Pi transcript data. */
export interface ApplicationStore {
  transaction<T>(fn: (tx: ApplicationStoreTransaction) => T): T;
  close(): void;
}
