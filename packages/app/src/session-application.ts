import { SessionError, type AgentMessage } from "@earendil-works/pi-agent-core";
import type {
  PiOperationSnapshot,
  PiSessionSnapshot,
  RuntimeBinding,
  DurablePiRuntime,
} from "@llm-space/pi-runtime";

import {
  APP_PI_LANE,
  APP_PI_RUNTIME_FORMAT_VERSION,
  type AgentExecutionResult,
  type AppCommandReceipt,
  type AppSessionRecord,
  type Session,
  type SessionContinueInput,
  type SessionEntry,
  type SessionInspectInput,
  type SessionStepInput,
  type Task,
} from "./domain";
import type { ApplicationStore } from "./storage";

export interface CreateSessionApplicationOptions {
  readonly runtime: DurablePiRuntime;
  readonly store: ApplicationStore;
  readonly agentId: string;
  readonly resolveBinding: (input: {
    readonly sessionId: string;
    readonly operationId: string;
    readonly messages: readonly AgentMessage[];
  }) => RuntimeBinding | Promise<RuntimeBinding>;
  readonly clock?: () => number;
  readonly generateId?: (prefix: string) => string;
}

export interface SessionApplication {
  createSession(input?: {
    readonly sessionId?: string;
    readonly name?: string;
    readonly projectId?: string;
  }): Promise<Session>;
  getSession(sessionId: string): Promise<Session | undefined>;
  listSessions(): Promise<readonly Session[]>;
  listEntries(sessionId: string): Promise<readonly SessionEntry[]>;
  listOperations(sessionId: string): Promise<readonly PiOperationSnapshot[]>;
  readCommitted(
    input: SessionInspectInput
  ): ReturnType<DurablePiRuntime["readCommitted"]>;
  step(input: SessionStepInput): Promise<PiSessionSnapshot>;
  continue(input: SessionContinueInput): Promise<PiSessionSnapshot>;
  recordSystemMessage(input: {
    readonly sessionId: string;
    readonly code: string;
    readonly text: string;
  }): Promise<string>;
  recordUserAction(input: {
    readonly sessionId: string;
    readonly action: string;
    readonly detail?: string;
  }): Promise<string>;
  createTask(input: {
    readonly sessionId: string;
    readonly title: string;
  }): Promise<Task>;
  listTasks(sessionId: string): Promise<readonly Task[]>;
  execute(input: {
    readonly sessionId: string;
    readonly messages: readonly AgentMessage[];
    readonly operationId?: string;
    readonly taskId?: string;
    readonly mode?: "step" | "continue";
    readonly signal?: AbortSignal;
  }): Promise<AgentExecutionResult>;
  abort(sessionId: string): Promise<void>;
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
  private _closed = false;
  private _closePromise: Promise<void> | undefined;

  constructor(private readonly _options: CreateSessionApplicationOptions) {
    this._clock = _options.clock ?? Date.now;
    this._generateId =
      _options.generateId ??
      ((prefix) => `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`);
  }

  /** Creates Pi first, then reconciles the App reference using its stable id. */
  async createSession(
    input: {
      readonly sessionId?: string;
      readonly name?: string;
      readonly projectId?: string;
    } = {}
  ): Promise<Session> {
    this._requireOpen();
    const sessionId = input.sessionId ?? this._generateId("session");
    const existing = this._options.store.transaction((tx) =>
      tx.getSession(sessionId)
    );
    if (existing !== undefined) {
      this._assertRecordOwner(existing);
      if (existing.projectId !== input.projectId) {
        throw new Error(
          `Session "${sessionId}" was already created for another Project.`
        );
      }
      return this._compose(existing);
    }

    let snapshot;
    let created = false;
    try {
      snapshot = await this._options.runtime.createSession({ id: sessionId });
      created = true;
    } catch (error) {
      if (!(error instanceof SessionError) || error.code !== "already_exists") {
        throw error;
      }
      snapshot = await this._options.runtime.open({
        sessionId,
        lane: APP_PI_LANE,
      });
    }
    const name = input.name?.trim() || "New Session";
    const currentName = await this._options.runtime.getSessionName(sessionId);
    if (!created && currentName !== undefined && currentName !== name) {
      throw new Error(
        `Pi Session "${sessionId}" was already created with another name.`
      );
    }
    if (currentName !== name) {
      await this._options.runtime.setSessionName(sessionId, name);
    }
    const now = this._clock();
    const record: AppSessionRecord = {
      schemaVersion: 2,
      sessionId,
      ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
      agentId: this._options.agentId,
      status: "active",
      createdAt: now,
      updatedAt: now,
    };
    this._options.store.transaction((tx) => tx.insertSession(record));
    return this._compose(record, snapshot, name);
  }

  async getSession(sessionId: string): Promise<Session | undefined> {
    this._requireOpen();
    const record = this._options.store.transaction((tx) =>
      tx.getSession(sessionId)
    );
    if (record === undefined) return undefined;
    this._assertRecordOwner(record);
    return this._compose(record);
  }

  async listSessions(): Promise<readonly Session[]> {
    this._requireOpen();
    const records = this._options.store.transaction((tx) => tx.listSessions());
    for (const record of records) this._assertRecordOwner(record);
    return Promise.all(records.map((record) => this._compose(record)));
  }

  /** Returns only Pi message/custom entries on the active branch. */
  async listEntries(sessionId: string): Promise<readonly SessionEntry[]> {
    this._requireRecord(sessionId);
    return (
      await this._options.runtime.listBranchEntries({
        sessionId,
        lane: APP_PI_LANE,
      })
    ).flatMap((entry) =>
      entry.type === "message" || entry.type === "custom" ? [entry] : []
    );
  }

  listOperations(sessionId: string): Promise<readonly PiOperationSnapshot[]> {
    this._requireRecord(sessionId);
    return this._options.runtime.listOperations({
      sessionId,
      lane: APP_PI_LANE,
    });
  }

  readCommitted(
    input: SessionInspectInput
  ): ReturnType<DurablePiRuntime["readCommitted"]> {
    this._requireRecord(input.sessionId);
    return this._options.runtime.readCommitted(input);
  }

  step(input: SessionStepInput): Promise<PiSessionSnapshot> {
    this._requireRecord(input.sessionId);
    return this._debugCommand("step", input, () =>
      this._options.runtime.step({
        sessionId: input.sessionId,
        ...(input.lane === undefined ? {} : { lane: input.lane }),
        expectedActionId: input.expectedActionId,
        kind: input.kind,
      })
    );
  }

  continue(input: SessionContinueInput): Promise<PiSessionSnapshot> {
    this._requireRecord(input.sessionId);
    return this._debugCommand("continue", input, () =>
      this._options.runtime.continue({
        sessionId: input.sessionId,
        ...(input.lane === undefined ? {} : { lane: input.lane }),
      })
    );
  }

  /** Persists the system timeline directly as a Pi CustomEntry. */
  async recordSystemMessage(input: {
    readonly sessionId: string;
    readonly code: string;
    readonly text: string;
  }): Promise<string> {
    this._requireRecord(input.sessionId);
    const id = await this._options.runtime.appendCustomEntry({
      sessionId: input.sessionId,
      lane: APP_PI_LANE,
      customType: "llm-space.system",
      data: {
        schemaVersion: 1,
        code: input.code,
        text: input.text,
        createdAt: this._clock(),
      },
    });
    this._touchSession(input.sessionId);
    return id;
  }

  /** Persists auditable user activity directly as a Pi CustomEntry. */
  async recordUserAction(input: {
    readonly sessionId: string;
    readonly action: string;
    readonly detail?: string;
  }): Promise<string> {
    this._requireRecord(input.sessionId);
    const id = await this._options.runtime.appendCustomEntry({
      sessionId: input.sessionId,
      lane: APP_PI_LANE,
      customType: "llm-space.user-action",
      data: {
        schemaVersion: 1,
        action: input.action,
        ...(input.detail === undefined ? {} : { detail: input.detail }),
        createdAt: this._clock(),
      },
    });
    this._touchSession(input.sessionId);
    return id;
  }

  createTask(input: {
    readonly sessionId: string;
    readonly title: string;
  }): Promise<Task> {
    this._requireRecord(input.sessionId);
    const now = this._clock();
    const task: Task = {
      schemaVersion: 2,
      id: this._generateId("task"),
      sessionId: input.sessionId,
      title: input.title.trim() || "New Task",
      status: "pending",
      createdAt: now,
      updatedAt: now,
    };
    this._options.store.transaction((tx) => tx.insertTask(task));
    return Promise.resolve(structuredClone(task));
  }

  listTasks(sessionId: string): Promise<readonly Task[]> {
    this._requireRecord(sessionId);
    return Promise.resolve(
      this._options.store.transaction((tx) => tx.listTasks(sessionId))
    );
  }

  /** Admits and drives one Pi operation; the final result is reconstructed from Pi. */
  async execute(input: {
    readonly sessionId: string;
    readonly messages: readonly AgentMessage[];
    readonly operationId?: string;
    readonly taskId?: string;
    readonly mode?: "step" | "continue";
    readonly signal?: AbortSignal;
  }): Promise<AgentExecutionResult> {
    this._requireRecord(input.sessionId);
    if (input.messages.length === 0) {
      throw new Error("Agent execution requires at least one Pi message.");
    }
    if (input.taskId !== undefined) {
      this._requireTask(input.taskId, input.sessionId);
    }
    input.signal?.throwIfAborted();
    const operationId = input.operationId ?? this._generateId("operation");
    let snapshot = await this._options.runtime.start({
      operationId,
      sessionId: input.sessionId,
      lane: APP_PI_LANE,
      messages: input.messages.map((message) => structuredClone(message)),
      binding: async () => {
        const binding = await this._options.resolveBinding({
          sessionId: input.sessionId,
          operationId,
          messages: input.messages,
        });
        input.signal?.throwIfAborted();
        return binding;
      },
    });
    if (input.taskId !== undefined) {
      this._setTaskOperation(input.taskId, input.sessionId, operationId);
    }

    const abort = () => {
      void this._options.runtime.abort({
        sessionId: input.sessionId,
        lane: APP_PI_LANE,
      });
    };
    input.signal?.addEventListener("abort", abort, { once: true });
    try {
      if (input.signal?.aborted) {
        snapshot = await this._options.runtime.abort({
          sessionId: input.sessionId,
          lane: APP_PI_LANE,
        });
      } else if (input.mode === "step") {
        if (snapshot.nextAction !== undefined) {
          snapshot = await this._options.runtime.step({
            sessionId: input.sessionId,
            lane: APP_PI_LANE,
            expectedActionId: snapshot.nextAction.id,
            kind: snapshot.nextAction.kind,
          });
        }
      } else {
        snapshot = await this._options.runtime.continue({
          sessionId: input.sessionId,
          lane: APP_PI_LANE,
        });
      }
    } catch (error) {
      if (!input.signal?.aborted) {
        this._projectTask(input.taskId, "failed");
        throw error;
      }
      snapshot = await this._options.runtime.abort({
        sessionId: input.sessionId,
        lane: APP_PI_LANE,
      });
    } finally {
      input.signal?.removeEventListener("abort", abort);
    }

    const operation = (
      await this._options.runtime.listOperations({
        sessionId: input.sessionId,
        lane: APP_PI_LANE,
      })
    ).find((candidate) => candidate.operationId === operationId);
    if (operation === undefined) {
      throw new Error(`Pi operation "${operationId}" was not found.`);
    }
    this._projectTask(
      input.taskId,
      _taskStatusForOperation(operation.status)
    );
    this._touchSession(input.sessionId);
    return {
      schemaVersion: 2,
      sessionId: input.sessionId,
      operation,
      snapshot,
      messages: structuredClone(snapshot.messages),
    };
  }

  /** Aborts the currently open Pi operation, if any. */
  async abort(sessionId: string): Promise<void> {
    this._requireRecord(sessionId);
    const snapshot = await this._options.runtime.open({
      sessionId,
      lane: APP_PI_LANE,
    });
    if (snapshot.status !== "paused" && snapshot.status !== "suspended") {
      return;
    }
    await this._options.runtime.abort({ sessionId, lane: APP_PI_LANE });
    for (const task of this._options.store.transaction((tx) =>
      tx.listTasks(sessionId)
    )) {
      if (task.operationId === snapshot.operationId) {
        this._projectTask(task.id, "cancelled");
      }
    }
    this._touchSession(sessionId);
  }

  close(): Promise<void> {
    this._closePromise ??= this._close();
    return this._closePromise;
  }

  private async _close(): Promise<void> {
    if (this._closed) return;
    this._closed = true;
    try {
      await this._options.runtime.close();
    } finally {
      this._options.store.close();
    }
  }

  private async _compose(
    record: AppSessionRecord,
    known?: Awaited<ReturnType<DurablePiRuntime["open"]>>,
    knownName?: string
  ): Promise<Session> {
    const snapshot =
      known ??
      (await this._options.runtime.open({
        sessionId: record.sessionId,
        lane: APP_PI_LANE,
      }));
    const name =
      knownName ??
      (await this._options.runtime.getSessionName(record.sessionId)) ??
      "New Session";
    return {
      ...structuredClone(record),
      lane: APP_PI_LANE,
      name,
      leafId: snapshot.leafId,
      ...(_activeOperationId(snapshot) === undefined
        ? {}
        : { operationId: _activeOperationId(snapshot) }),
      runtimeFormatVersion: APP_PI_RUNTIME_FORMAT_VERSION,
    };
  }

  private _requireRecord(sessionId: string): AppSessionRecord {
    this._requireOpen();
    const record = this._options.store.transaction((tx) =>
      tx.getSession(sessionId)
    );
    if (record === undefined) {
      throw new Error(`Session "${sessionId}" was not found.`);
    }
    this._assertRecordOwner(record);
    return record;
  }

  /** Prevents a changed project Agent from adopting durable Sessions. */
  private _assertRecordOwner(record: AppSessionRecord): void {
    if (record.agentId !== this._options.agentId) {
      throw new Error(
        `Session "${record.sessionId}" belongs to Agent "${record.agentId}", not "${this._options.agentId}".`
      );
    }
  }

  private _touchSession(sessionId: string): void {
    const record = this._requireRecord(sessionId);
    this._options.store.transaction((tx) =>
      tx.saveSession({ ...record, updatedAt: this._clock() })
    );
  }

  private _setTaskOperation(
    taskId: string,
    sessionId: string,
    operationId: string
  ): void {
    this._options.store.transaction((tx) => {
      const task = tx.getTask(taskId);
      if (task?.sessionId !== sessionId) {
        throw new Error(
          `Task "${taskId}" does not belong to Session "${sessionId}".`
        );
      }
      tx.saveTask({
        ...task,
        operationId,
        status: "running",
        updatedAt: this._clock(),
      });
    });
  }

  private _requireTask(taskId: string, sessionId: string): Task {
    const task = this._options.store.transaction((tx) => tx.getTask(taskId));
    if (task?.sessionId !== sessionId) {
      throw new Error(
        `Task "${taskId}" does not belong to Session "${sessionId}".`
      );
    }
    return task;
  }

  private _projectTask(
    taskId: string | undefined,
    status: Task["status"]
  ): void {
    if (taskId === undefined) return;
    this._options.store.transaction((tx) => {
      const task = tx.getTask(taskId);
      if (task === undefined) return;
      tx.saveTask({ ...task, status, updatedAt: this._clock() });
    });
  }

  /** Durably accepts debugger identity before effects and reconciles retries from Pi. */
  private async _debugCommand(
    method: "step" | "continue",
    input: SessionStepInput | SessionContinueInput,
    execute: () => Promise<PiSessionSnapshot>
  ): Promise<PiSessionSnapshot> {
    const fingerprint = JSON.stringify({ method, input });
    let receipt = this._options.store.transaction((tx) =>
      tx.getCommandReceipt(input.sessionId, input.commandId)
    );
    if (receipt !== undefined) {
      if (receipt.method !== method || receipt.fingerprint !== fingerprint) {
        throw new Error(
          `Command "${input.commandId}" was already used with other input.`
        );
      }
      const current = await this._options.runtime.open({
        sessionId: input.sessionId,
        ...(input.lane === undefined ? {} : { lane: input.lane }),
      });
      if (receipt.status === "applied") {
        await this._reconcileOperationMetadata(input.sessionId, current);
        return current;
      }
      if (!_debugCommandNeedsExecution(method, input, current)) {
        await this._finalizeDebugCommand(receipt, current);
        return current;
      }
    } else {
      const acceptedReceipt = {
        sessionId: input.sessionId,
        commandId: input.commandId,
        method,
        status: "accepted" as const,
        fingerprint,
        createdAt: this._clock(),
      };
      this._options.store.transaction((tx) =>
        tx.insertCommandReceipt(acceptedReceipt)
      );
      receipt = acceptedReceipt;
    }

    if (receipt === undefined) {
      throw new Error(`Command "${input.commandId}" was not accepted.`);
    }
    const snapshot = await execute();
    await this._finalizeDebugCommand(receipt, snapshot);
    return snapshot;
  }

  /** Marks the command applied before replaying its idempotent product projection. */
  private async _finalizeDebugCommand(
    receipt: AppCommandReceipt,
    snapshot: PiSessionSnapshot
  ): Promise<void> {
    this._options.store.transaction((tx) => {
      tx.saveCommandReceipt({
        ...receipt,
        status: "applied",
        ...(snapshot.operationId === undefined
          ? {}
          : { operationId: snapshot.operationId }),
        ...(snapshot.leafId === null ? {} : { leafId: snapshot.leafId }),
      });
    });
    await this._reconcileOperationMetadata(receipt.sessionId, snapshot);
  }

  /** Replays product projections after either debugger crash window. */
  private async _reconcileOperationMetadata(
    sessionId: string,
    snapshot: PiSessionSnapshot
  ): Promise<void> {
    let operation: PiOperationSnapshot | undefined;
    if (snapshot.operationId !== undefined) {
      operation = (
        await this._options.runtime.listOperations({
          sessionId,
          lane: snapshot.lane,
        })
      ).find((candidate) => candidate.operationId === snapshot.operationId);
    }
    const now = this._clock();
    this._options.store.transaction((tx) => {
      const session = tx.getSession(sessionId);
      if (session === undefined) {
        throw new Error(`Session "${sessionId}" was not found.`);
      }
      this._assertRecordOwner(session);
      tx.saveSession({ ...session, updatedAt: now });
      if (operation !== undefined) {
        for (const task of tx.listTasks(sessionId)) {
          if (task.operationId === operation.operationId) {
            tx.saveTask({
              ...task,
              status: _taskStatusForOperation(operation.status),
              updatedAt: now,
            });
          }
        }
      }
    });
  }

  private _requireOpen(): void {
    if (this._closed) throw new Error("Session application is closed.");
  }
}

function _activeOperationId(snapshot: PiSessionSnapshot): string | undefined {
  return snapshot.status === "paused" || snapshot.status === "suspended"
    ? snapshot.operationId
    : undefined;
}

function _debugCommandNeedsExecution(
  method: "step" | "continue",
  input: SessionStepInput | SessionContinueInput,
  snapshot: PiSessionSnapshot
): boolean {
  if (method === "step") {
    return (
      "expectedActionId" in input &&
      snapshot.nextAction?.id === input.expectedActionId
    );
  }
  return snapshot.status === "paused";
}

/** Projects Pi operation lifecycle without treating a debugger pause as failure. */
function _taskStatusForOperation(
  status: PiOperationSnapshot["status"]
): Task["status"] {
  if (status === "completed") return "completed";
  if (status === "aborted") return "cancelled";
  if (status === "failed" || status === "declined") return "failed";
  return "running";
}
