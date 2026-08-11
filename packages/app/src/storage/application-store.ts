import type {
  ApplicationRunIntent,
  Session,
  SessionMessage,
  SessionRunLink,
  Task,
} from "../domain";

export interface ApplicationStoreTransaction {
  getSession(sessionId: string): Session | undefined;
  listSessions(): readonly Session[];
  insertSession(session: Session): void;
  saveSession(session: Session): void;

  getTask(taskId: string): Task | undefined;
  listTasks(sessionId: string): readonly Task[];
  insertTask(task: Task): void;
  saveTask(task: Task): void;

  upsertSessionMessage(message: SessionMessage): "inserted" | "updated";
  listSessionMessages(sessionId: string): readonly SessionMessage[];

  insertRunLink(link: SessionRunLink): "inserted" | "existing";
  getRunLink(runId: string): SessionRunLink | undefined;
  /** Returns links in durable insertion order, including equal timestamps. */
  listRunLinks(sessionId: string): readonly SessionRunLink[];

  getRunIntent(operationId: string): ApplicationRunIntent | undefined;
  listRunIntents(): readonly ApplicationRunIntent[];
  insertRunIntent(intent: ApplicationRunIntent): void;
  deleteRunIntent(operationId: string): void;
}

/** Application persistence seam; implementations share no Engine table ownership. */
export interface ApplicationStore {
  transaction<T>(fn: (tx: ApplicationStoreTransaction) => T): T;
  close(): void;
}
