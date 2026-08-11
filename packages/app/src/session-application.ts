import type { Message } from "@llm-space/core";
import type {
  AgentEngine,
  AgentSnapshot,
  Run,
  RunEventCursor,
  RunFrame,
  ThreadState,
} from "@llm-space/engine";

import type {
  ApplicationRunIntent,
  ModelSessionMessage,
  Session,
  SessionMessage,
  SessionRunLink,
  SystemSessionMessage,
  Task,
  UserActionSessionMessage,
} from "./domain";
import type { ApplicationStore, ApplicationStoreTransaction } from "./storage";

export interface CreateSessionApplicationOptions {
  readonly engine: AgentEngine;
  readonly store: ApplicationStore;
  readonly clock?: () => number;
  readonly generateId?: (prefix: string) => string;
}

export interface SessionApplication {
  createSession(input: {
    readonly title?: string;
    readonly projectId?: string;
    readonly agentId: string;
    readonly initialThreadState?: ThreadState;
  }): Promise<Session>;
  getSession(sessionId: string): Promise<Session | undefined>;
  listSessions(): Promise<readonly Session[]>;
  listMessages(sessionId: string): Promise<readonly SessionMessage[]>;
  recordSystemMessage(input: {
    readonly sessionId: string;
    readonly code: string;
    readonly text: string;
  }): Promise<SystemSessionMessage>;
  recordUserAction(input: {
    readonly sessionId: string;
    readonly action: string;
    readonly detail?: string;
  }): Promise<UserActionSessionMessage>;
  createTask(input: {
    readonly sessionId: string;
    readonly title: string;
  }): Promise<Task>;
  listTasks(sessionId: string): Promise<readonly Task[]>;
  listRuns(sessionId: string): Promise<readonly Run[]>;
  startRun(input: {
    readonly sessionId: string;
    readonly message: Extract<Message, { role: "user" }>;
    readonly agentSnapshot: AgentSnapshot;
    readonly taskId?: string;
    readonly operationId?: string;
  }): Promise<Run>;
  retryTaskRun(input: {
    readonly sessionId: string;
    readonly taskId: string;
    readonly runId: string;
    readonly operationId?: string;
  }): Promise<Run>;
  cancelRun(sessionId: string, runId: string): Promise<void>;
  streamRun(
    sessionId: string,
    runId: string,
    cursor?: RunEventCursor
  ): AsyncIterable<RunFrame>;
  close(): Promise<void>;
}

export function createSessionApplication(
  options: CreateSessionApplicationOptions
): SessionApplication {
  return new SessionApplicationImpl(options);
}

class SessionApplicationImpl implements SessionApplication {
  private readonly _clock: () => number;
  private readonly _generateId: (prefix: string) => string;
  private readonly _recovery: Promise<void>;
  private readonly _projections = new Map<string, Promise<void>>();
  private _closed = false;
  private _closePromise: Promise<void> | undefined;

  constructor(private readonly _options: CreateSessionApplicationOptions) {
    this._clock = _options.clock ?? Date.now;
    this._generateId =
      _options.generateId ??
      ((prefix) => `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`);
    this._recovery = Promise.resolve().then(() => this._recover());
    void this._recovery.catch(() => undefined);
  }

  async createSession(input: {
    readonly title?: string;
    readonly projectId?: string;
    readonly agentId: string;
    readonly initialThreadState?: ThreadState;
  }): Promise<Session> {
    await this._recovery;
    const thread = await this._options.engine.createThread({
      ...(input.initialThreadState === undefined
        ? {}
        : { initialState: input.initialThreadState }),
    });
    const now = this._clock();
    const session: Session = {
      schemaVersion: 1,
      id: this._generateId("session"),
      ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
      threadId: thread.id,
      agentId: input.agentId,
      title: input.title?.trim() || "New Session",
      status: "active",
      createdAt: now,
      updatedAt: now,
    };
    this._options.store.transaction((tx) => tx.insertSession(session));
    return structuredClone(session);
  }

  async getSession(sessionId: string): Promise<Session | undefined> {
    await this._recovery;
    return this._options.store.transaction((tx) => tx.getSession(sessionId));
  }

  async listSessions(): Promise<readonly Session[]> {
    await this._recovery;
    return this._options.store.transaction((tx) => tx.listSessions());
  }

  async listMessages(sessionId: string): Promise<readonly SessionMessage[]> {
    await this._recovery;
    return this._options.store.transaction((tx) =>
      tx.listSessionMessages(sessionId)
    );
  }

  async recordSystemMessage(input: {
    readonly sessionId: string;
    readonly code: string;
    readonly text: string;
  }): Promise<SystemSessionMessage> {
    await this._recovery;
    const message: SystemSessionMessage = {
      schemaVersion: 1,
      id: this._generateId("message"),
      sessionId: input.sessionId,
      type: "system",
      code: input.code,
      text: input.text,
      createdAt: this._clock(),
    };
    this._options.store.transaction((tx) => {
      _requireSession(tx.getSession(input.sessionId), input.sessionId);
      tx.upsertSessionMessage(message);
    });
    return structuredClone(message);
  }

  async recordUserAction(input: {
    readonly sessionId: string;
    readonly action: string;
    readonly detail?: string;
  }): Promise<UserActionSessionMessage> {
    await this._recovery;
    const message: UserActionSessionMessage = {
      schemaVersion: 1,
      id: this._generateId("message"),
      sessionId: input.sessionId,
      type: "user-action",
      action: input.action,
      ...(input.detail === undefined ? {} : { detail: input.detail }),
      createdAt: this._clock(),
    };
    this._options.store.transaction((tx) => {
      _requireSession(tx.getSession(input.sessionId), input.sessionId);
      tx.upsertSessionMessage(message);
    });
    return structuredClone(message);
  }

  async createTask(input: {
    readonly sessionId: string;
    readonly title: string;
  }): Promise<Task> {
    await this._recovery;
    const now = this._clock();
    const task = this._options.store.transaction((tx) => {
      _requireSession(tx.getSession(input.sessionId), input.sessionId);
      const value: Task = {
        schemaVersion: 1,
        id: this._generateId("task"),
        sessionId: input.sessionId,
        title: input.title.trim() || "New Task",
        status: "pending",
        createdAt: now,
        updatedAt: now,
      };
      tx.insertTask(value);
      return value;
    });
    return structuredClone(task);
  }

  async listTasks(sessionId: string): Promise<readonly Task[]> {
    await this._recovery;
    return this._options.store.transaction((tx) => tx.listTasks(sessionId));
  }

  async listRuns(sessionId: string): Promise<readonly Run[]> {
    await this._recovery;
    const links = this._options.store.transaction((tx) => {
      _requireSession(tx.getSession(sessionId), sessionId);
      return tx.listRunLinks(sessionId);
    });
    const runs = await Promise.all(
      links.map((link) => this._options.engine.getRun(link.runId))
    );
    return runs.filter((run): run is Run => run !== undefined);
  }

  async startRun(input: {
    readonly sessionId: string;
    readonly message: Extract<Message, { role: "user" }>;
    readonly agentSnapshot: AgentSnapshot;
    readonly taskId?: string;
    readonly operationId?: string;
  }): Promise<Run> {
    await this._recovery;
    const session = this._options.store.transaction((tx) =>
      _requireSession(tx.getSession(input.sessionId), input.sessionId)
    );
    const operationId = input.operationId ?? this._generateId("operation");
    const candidate: ApplicationRunIntent = {
      schemaVersion: 1,
      operationId,
      sessionId: session.id,
      ...(input.taskId === undefined ? {} : { taskId: input.taskId }),
      type: "start",
      message: structuredClone(input.message),
      createdAt: this._clock(),
    };
    const existingRun =
      await this._options.engine.getRunByOperationId(operationId);
    if (existingRun !== undefined) {
      _assertStartRunMatches(existingRun, candidate, input.agentSnapshot);
      const existingLink = this._options.store.transaction((tx) =>
        tx.getRunLink(existingRun.id)
      );
      if (existingLink !== undefined) {
        _assertRunLinkMatches(existingLink, candidate);
        this._scheduleRunProjection(existingLink);
        return existingRun;
      }
    }
    const thread =
      existingRun === undefined
        ? await this._options.engine.getThread(session.threadId)
        : undefined;
    if (existingRun === undefined && thread === undefined) {
      throw new Error(`Thread "${session.threadId}" was not found.`);
    }
    const intent = this._options.store.transaction((tx) => {
      const current = _requireSession(
        tx.getSession(input.sessionId),
        input.sessionId
      );
      if (existingRun === undefined && current.threadId !== thread?.id) {
        throw new Error(`Session "${current.id}" continuation Thread changed.`);
      }
      if (input.taskId !== undefined) {
        _requireTask(tx.getTask(input.taskId), input.taskId, current.id);
      }
      return _insertRunIntent(tx, candidate);
    });
    let run = existingRun;
    if (run === undefined) {
      try {
        run = await this._options.engine.startRun({
          threadId: thread!.id,
          expectedHeadCheckpointId: thread!.headCheckpointId,
          inputMessages: [input.message],
          agentSnapshot: input.agentSnapshot,
          operationId,
        });
      } catch (error) {
        this._deleteRunIntent(operationId);
        throw error;
      }
    }
    const link = this._finalizeRunIntent(intent, run);
    this._scheduleRunProjection(link);
    return run;
  }

  async retryTaskRun(input: {
    readonly sessionId: string;
    readonly taskId: string;
    readonly runId: string;
    readonly operationId?: string;
  }): Promise<Run> {
    await this._recovery;
    const current = this._options.store.transaction((tx) => {
      const session = _requireSession(
        tx.getSession(input.sessionId),
        input.sessionId
      );
      _requireTask(tx.getTask(input.taskId), input.taskId, session.id);
      const link = tx.getRunLink(input.runId);
      if (link?.sessionId !== session.id || link.taskId !== input.taskId) {
        throw new Error(
          `Run "${input.runId}" does not belong to Task "${input.taskId}".`
        );
      }
      return session;
    });
    const operationId = input.operationId ?? this._generateId("operation");
    const candidate: ApplicationRunIntent = {
      schemaVersion: 1,
      operationId,
      sessionId: current.id,
      taskId: input.taskId,
      type: "retry",
      retryOfRunId: input.runId,
      createdAt: this._clock(),
    };
    const existingRun =
      await this._options.engine.getRunByOperationId(operationId);
    if (existingRun !== undefined) {
      _assertRetryRunMatches(existingRun, candidate);
      const existingLink = this._options.store.transaction((tx) =>
        tx.getRunLink(existingRun.id)
      );
      if (existingLink !== undefined) {
        _assertRunLinkMatches(existingLink, candidate);
        this._scheduleRunProjection(existingLink);
        return existingRun;
      }
    }
    const intent = this._options.store.transaction((tx) => {
      _requireSession(tx.getSession(current.id), current.id);
      _requireTask(tx.getTask(input.taskId), input.taskId, current.id);
      return _insertRunIntent(tx, candidate);
    });
    let retry = existingRun;
    if (retry === undefined) {
      try {
        retry = await this._options.engine.retryRun({
          runId: input.runId,
          operationId,
        });
      } catch (error) {
        this._deleteRunIntent(operationId);
        throw error;
      }
    }
    const link = this._finalizeRunIntent(intent, retry);
    this._scheduleRunProjection(link);
    return retry;
  }

  async cancelRun(sessionId: string, runId: string): Promise<void> {
    await this._recovery;
    const link = this._options.store.transaction((tx) => tx.getRunLink(runId));
    if (link?.sessionId !== sessionId) {
      throw new Error(
        `Run "${runId}" does not belong to Session "${sessionId}".`
      );
    }
    await this._options.engine.cancelRun(runId);
  }

  async *streamRun(
    sessionId: string,
    runId: string,
    cursor: RunEventCursor = {}
  ): AsyncIterable<RunFrame> {
    await this._recovery;
    const link = this._options.store.transaction((tx) => tx.getRunLink(runId));
    if (link?.sessionId !== sessionId) {
      throw new Error(
        `Run "${runId}" does not belong to Session "${sessionId}".`
      );
    }
    for await (const frame of this._options.engine.streamRun(runId, cursor)) {
      this._projectFrame(link, frame);
      yield frame;
    }
  }

  /** Stop Engine work before releasing Application-owned persistence. */
  close(): Promise<void> {
    this._closePromise ??= this._close();
    return this._closePromise;
  }

  private async _close(): Promise<void> {
    this._closed = true;
    try {
      // Recovery can still be reading Engine state when close begins. Let that
      // bounded reconciliation stop at `_closed` before releasing Engine data.
      await Promise.allSettled([this._recovery]);
      await this._options.engine.close();
      await Promise.allSettled(this._projections.values());
    } finally {
      this._options.store.close();
    }
  }

  private async _recover(): Promise<void> {
    for (const intent of this._options.store.transaction((tx) =>
      tx.listRunIntents()
    )) {
      if (this._closed) return;
      try {
        const run = await this._options.engine.getRunByOperationId(
          intent.operationId
        );
        if (run === undefined) {
          this._deleteRunIntent(intent.operationId);
          continue;
        }
        this._finalizeRunIntent(intent, run);
      } catch {
        // One inconsistent association must not prevent unrelated Sessions
        // from recovering. Keep the intent durable for diagnosis or a later
        // retry instead of discarding a Run that already exists in Engine.
      }
    }
    await this._recoverRunProjections();
  }

  private _finalizeRunIntent(
    intent: ApplicationRunIntent,
    run: Run
  ): SessionRunLink {
    const now = this._clock();
    return this._options.store.transaction((tx) => {
      const session = _requireSession(
        tx.getSession(intent.sessionId),
        intent.sessionId
      );
      if (intent.type === "start" && session.threadId !== run.threadId) {
        throw new Error(`Session "${session.id}" continuation Thread changed.`);
      }
      const link = _runLink(session.id, run, intent.taskId, now);
      const existingLink = tx.getRunLink(run.id);
      if (existingLink !== undefined) {
        _assertRunLinkMatches(existingLink, intent);
      }
      tx.insertRunLink(link);
      if (intent.type === "start") {
        tx.upsertSessionMessage({
          schemaVersion: 1,
          id: intent.message.id,
          sessionId: session.id,
          type: "model",
          threadId: run.threadId,
          runId: run.id,
          message: structuredClone(intent.message),
          createdAt: intent.createdAt,
        });
      }
      if (intent.taskId !== undefined) {
        const task = _requireTask(
          tx.getTask(intent.taskId),
          intent.taskId,
          session.id
        );
        tx.saveTask({ ...task, status: "running", updatedAt: now });
        if (_isTerminal(run.status)) {
          _projectTaskStatus(tx, link, run.status, now);
        }
      }
      tx.saveSession({
        ...session,
        ...(intent.type === "retry" ? { threadId: run.threadId } : {}),
        updatedAt: now,
      });
      tx.deleteRunIntent(intent.operationId);
      return existingLink ?? link;
    });
  }

  private _deleteRunIntent(operationId: string): void {
    this._options.store.transaction((tx) => tx.deleteRunIntent(operationId));
  }

  private async _recoverRunProjections(): Promise<void> {
    if (this._closed) return;
    const links = this._options.store.transaction((tx) =>
      tx.listSessions().flatMap((session) => tx.listRunLinks(session.id))
    );
    for (const link of links) {
      let terminal = false;
      for await (const frame of this._options.engine.streamRun(link.runId)) {
        this._projectFrame(link, frame);
        terminal = frame.type === "snapshot" && _isTerminal(frame.run.status);
      }
      if (!terminal) this._scheduleRunProjection(link);
    }
  }

  private _scheduleRunProjection(link: SessionRunLink): void {
    if (this._closed || this._projections.has(link.runId)) return;
    const projection = this._projectRun(link).finally(() => {
      this._projections.delete(link.runId);
    });
    this._projections.set(link.runId, projection);
    // Projection is retried from the durable Run snapshot on the next App
    // startup. UI stream consumption remains an immediate idempotent fallback.
    void projection.catch(() => undefined);
  }

  private async _projectRun(link: SessionRunLink): Promise<void> {
    for await (const frame of this._options.engine.streamRun(link.runId, {
      follow: true,
    })) {
      this._projectFrame(link, frame);
    }
  }

  private _projectFrame(link: SessionRunLink, frame: RunFrame): void {
    const now = this._clock();
    this._options.store.transaction((tx) => {
      if (frame.type === "snapshot") {
        for (const output of frame.outputs) {
          if (output.status === "completed") {
            _insertProjectedMessage(tx, link, output.message, output.updatedAt);
          }
        }
        if (_isTerminal(frame.run.status)) {
          _projectTaskStatus(tx, link, frame.run.status, now);
        }
        return;
      }
      if (
        frame.event.type === "message.completed" ||
        frame.event.type === "tool.completed"
      ) {
        _insertProjectedMessage(tx, link, frame.event.message, now);
      } else if (
        frame.event.type === "run.updated" &&
        _isTerminal(frame.event.run.status)
      ) {
        _projectTaskStatus(tx, link, frame.event.run.status, now);
      }
    });
  }
}

function _insertProjectedMessage(
  tx: ApplicationStoreTransaction,
  link: SessionRunLink,
  message: Message,
  createdAt: number
): void {
  const projected: ModelSessionMessage = {
    schemaVersion: 1,
    id: message.id,
    sessionId: link.sessionId,
    type: "model",
    threadId: link.threadId,
    runId: link.runId,
    message: structuredClone(message),
    createdAt,
  };
  tx.upsertSessionMessage(projected);
}

function _insertRunIntent(
  tx: ApplicationStoreTransaction,
  intent: ApplicationRunIntent
): ApplicationRunIntent {
  const existing = tx.getRunIntent(intent.operationId);
  if (existing === undefined) {
    tx.insertRunIntent(intent);
    return intent;
  }
  if (!_sameRunIntentInput(existing, intent)) {
    throw new Error(
      `Run intent "${intent.operationId}" was reused with different input.`
    );
  }
  return existing;
}

function _sameRunIntentInput(
  left: ApplicationRunIntent,
  right: ApplicationRunIntent
): boolean {
  return (
    left.schemaVersion === right.schemaVersion &&
    left.operationId === right.operationId &&
    left.sessionId === right.sessionId &&
    left.taskId === right.taskId &&
    left.type === right.type &&
    (left.type === "start" && right.type === "start"
      ? _sameJson(left.message, right.message)
      : left.type === "retry" &&
        right.type === "retry" &&
        left.retryOfRunId === right.retryOfRunId)
  );
}

function _assertStartRunMatches(
  run: Run,
  intent: Extract<ApplicationRunIntent, { type: "start" }>,
  agentSnapshot: AgentSnapshot
): void {
  if (
    run.retryOfRunId !== undefined ||
    !_sameJson(run.inputMessages, [intent.message]) ||
    !_sameJson(run.agentSnapshot, agentSnapshot)
  ) {
    throw new Error(
      `Run operation "${intent.operationId}" was reused with different Application input.`
    );
  }
}

function _assertRetryRunMatches(
  run: Run,
  intent: Extract<ApplicationRunIntent, { type: "retry" }>
): void {
  if (run.retryOfRunId !== intent.retryOfRunId) {
    throw new Error(
      `Run operation "${intent.operationId}" was reused with different Application input.`
    );
  }
}

function _assertRunLinkMatches(
  link: SessionRunLink,
  intent: ApplicationRunIntent
): void {
  if (link.sessionId !== intent.sessionId || link.taskId !== intent.taskId) {
    throw new Error(
      `Run operation "${intent.operationId}" was reused with different Application input.`
    );
  }
}

function _sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function _projectTaskStatus(
  tx: ApplicationStoreTransaction,
  link: SessionRunLink,
  status: Run["status"],
  now: number
): void {
  if (link.taskId === undefined) return;
  const task = tx.getTask(link.taskId);
  if (task === undefined) return;
  const latest = tx
    .listRunLinks(link.sessionId)
    .findLast((candidate) => candidate.taskId === link.taskId);
  if (latest?.runId !== link.runId) return;
  const taskStatus: Task["status"] =
    status === "completed"
      ? "completed"
      : status === "cancelled"
        ? "cancelled"
        : "failed";
  tx.saveTask({ ...task, status: taskStatus, updatedAt: now });
}

function _runLink(
  sessionId: string,
  run: Run,
  taskId: string | undefined,
  createdAt: number
): SessionRunLink {
  return {
    schemaVersion: 1,
    sessionId,
    threadId: run.threadId,
    runId: run.id,
    ...(taskId === undefined ? {} : { taskId }),
    createdAt,
  };
}

function _requireSession(
  session: Session | undefined,
  sessionId: string
): Session {
  if (session === undefined)
    throw new Error(`Session "${sessionId}" was not found.`);
  return session;
}

function _requireTask(
  task: Task | undefined,
  taskId: string,
  sessionId: string
): Task {
  if (task?.sessionId !== sessionId) {
    throw new Error(
      `Task "${taskId}" was not found in Session "${sessionId}".`
    );
  }
  return task;
}

function _isTerminal(status: Run["status"]): boolean {
  return (
    status === "completed" ||
    status === "failed" ||
    status === "cancelled" ||
    status === "interrupted"
  );
}
