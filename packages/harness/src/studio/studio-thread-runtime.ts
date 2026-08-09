import type { Conversation } from "../conversation";
import type {
  Evaluation,
  EvaluationRepository,
  EvaluationRubric,
  EvaluationRubricRepository,
  StudioEvaluationMetadata,
  StudioEvaluationMetadataInput,
} from "../evaluation";
import type {
  ExecutableAgent,
  Run,
  RunExecutor,
  RunOutputEvent,
  RunRepository,
} from "../run";

import type { AgentSnapshot } from "./agent-snapshot";
import type {
  StudioEventCursor,
  StudioThreadEvent,
  StudioThreadEventLog,
  StudioThreadRepository,
  ThreadCheckpointRepository,
  ThreadRunIndexRepository,
  ThreadRunReference,
} from "./studio-repositories";
import type { StudioThread, StudioThreadDocument } from "./studio-thread";
import type { ThreadCheckpoint } from "./thread-checkpoint";

export interface SourceRevisionProvider {
  current(): Promise<string>;
}

export class StudioThreadOutdatedError extends Error {
  constructor(
    readonly threadCommitId: string,
    readonly currentCommitId: string
  ) {
    super(
      `Studio Thread is bound to commit "${threadCommitId}", but the project is at "${currentCommitId}".`
    );
    this.name = "StudioThreadOutdatedError";
  }
}

export interface CreateStudioThreadRuntimeOptions {
  readonly executor: RunExecutor;
  readonly threadRepository: StudioThreadRepository;
  readonly runRepository: RunRepository;
  readonly evaluationRepository: EvaluationRepository;
  readonly evaluationRubricRepository: EvaluationRubricRepository;
  readonly checkpointRepository: ThreadCheckpointRepository;
  readonly runIndexRepository: ThreadRunIndexRepository;
  readonly eventLog: StudioThreadEventLog;
  readonly revisionProvider: SourceRevisionProvider;
  readonly resolveAgent?: (snapshot: AgentSnapshot) => Promise<ExecutableAgent>;
  readonly resolveCurrentAgent?: () => Promise<ExecutableAgent>;
  readonly clock?: () => number;
  readonly generateId?: (prefix: string) => string;
}

export interface CreateStudioThreadInput {
  readonly title?: string;
  readonly agent: AgentSnapshot;
  readonly conversation?: Conversation;
  readonly provenance?: StudioThread["provenance"];
  /** Pins a host-resolved Agent to the revision it was loaded from. */
  readonly commitId?: string;
}

export interface StudioRunReceipt {
  readonly runId: string;
}

export interface StudioRunHistoryEntry {
  readonly reference: ThreadRunReference;
  readonly run: Run;
  readonly checkpoint?: ThreadCheckpoint;
}

export interface StudioThreadRuntime {
  createThread(input: CreateStudioThreadInput): Promise<StudioThread>;
  loadThread(threadId: string): Promise<StudioThread | undefined>;
  listThreads(): Promise<readonly StudioThread[]>;
  listRunHistory(threadId: string): Promise<readonly StudioRunHistoryEntry[]>;
  saveRunHistory(
    threadId: string,
    runIds: readonly string[]
  ): Promise<readonly StudioRunHistoryEntry[]>;
  listEvaluationMetadata(threadId: string): Promise<StudioEvaluationMetadata>;
  saveEvaluationMetadata(
    threadId: string,
    input: StudioEvaluationMetadataInput
  ): Promise<StudioEvaluationMetadata>;
  forkThread(
    threadId: string,
    input?: { readonly checkpointId?: string }
  ): Promise<StudioThread>;
  saveDocument(
    threadId: string,
    document: StudioThreadDocument
  ): Promise<StudioThread>;
  run(
    threadId: string,
    input: { readonly fromMessageId: string }
  ): Promise<StudioRunReceipt>;
  cancelRun(runId: string): Promise<void>;
  events(
    threadId: string,
    cursor?: StudioEventCursor
  ): AsyncIterable<StudioThreadEvent>;
}

export function createStudioThreadRuntime(
  options: CreateStudioThreadRuntimeOptions
): StudioThreadRuntime {
  return new StudioThreadRuntimeImpl(options);
}

class StudioThreadRuntimeImpl implements StudioThreadRuntime {
  private readonly _clock: () => number;
  private readonly _generateId: (prefix: string) => string;
  private readonly _abortControllers = new Map<string, AbortController>();
  private readonly _executions = new Map<string, Promise<void>>();
  private readonly _eventSequences = new Map<string, number>();
  private readonly _recoveries = new Map<string, Promise<StudioThread>>();

  constructor(private readonly _options: CreateStudioThreadRuntimeOptions) {
    this._clock = _options.clock ?? Date.now;
    this._generateId =
      _options.generateId ??
      ((prefix) => `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`);
  }

  async createThread(input: CreateStudioThreadInput): Promise<StudioThread> {
    const now = this._clock();
    const currentCommitId = await this._options.revisionProvider.current();
    if (input.commitId !== undefined && input.commitId !== currentCommitId) {
      throw new StudioThreadOutdatedError(input.commitId, currentCommitId);
    }
    const thread: StudioThread = {
      schemaVersion: 1,
      id: this._generateId("thread"),
      document: {
        title: input.title?.trim() || "New Thread",
        agent: structuredClone(input.agent),
        conversation: structuredClone(
          input.conversation ?? { messages: [], state: {} }
        ),
        commitId: currentCommitId,
      },
      ...(input.provenance === undefined
        ? {}
        : { provenance: structuredClone(input.provenance) }),
      createdAt: now,
      updatedAt: now,
    };
    if ((await this._options.threadRepository.create(thread)) === "existing") {
      throw new Error(`Studio Thread "${thread.id}" already exists.`);
    }
    return structuredClone(thread);
  }

  async loadThread(threadId: string): Promise<StudioThread | undefined> {
    const thread = await this._options.threadRepository.load(threadId);
    return thread === undefined ? undefined : this._recoverThread(thread);
  }

  async listThreads(): Promise<readonly StudioThread[]> {
    const threads = await Promise.all(
      (await this._options.threadRepository.list()).map((thread) =>
        this._recoverThread(thread)
      )
    );
    return threads.toSorted(
      (left, right) =>
        right.updatedAt - left.updatedAt || left.id.localeCompare(right.id)
    );
  }

  async listRunHistory(
    threadId: string
  ): Promise<readonly StudioRunHistoryEntry[]> {
    const references = await this._options.runIndexRepository.list(threadId);
    const entries = await Promise.all(
      references.map(
        async (reference): Promise<StudioRunHistoryEntry | undefined> => {
          const run = await this._options.runRepository.load(reference.runId);
          if (run === undefined) return undefined;
          const checkpoint =
            reference.checkpointId === undefined
              ? undefined
              : await this._options.checkpointRepository.load(
                  reference.checkpointId
                );
          return {
            reference,
            run,
            ...(checkpoint === undefined ? {} : { checkpoint }),
          };
        }
      )
    );
    return entries.filter(
      (entry): entry is StudioRunHistoryEntry => entry !== undefined
    );
  }

  async saveRunHistory(
    threadId: string,
    runIds: readonly string[]
  ): Promise<readonly StudioRunHistoryEntry[]> {
    await this._requireThread(threadId);
    _assertUniqueIds(
      runIds.map((id) => ({ id })),
      "Run"
    );
    const references = await this._options.runIndexRepository.list(threadId);
    const byId = new Map(
      references.map((reference) => [reference.runId, reference])
    );
    const next = runIds.map((runId) => {
      const reference = byId.get(runId);
      if (reference === undefined) {
        throw new Error(
          `Run "${runId}" does not belong to Thread "${threadId}".`
        );
      }
      return reference;
    });
    await this._options.runIndexRepository.replace(threadId, next);
    const retained = new Set(runIds);
    const evaluations =
      await this._options.evaluationRepository.listByThread(threadId);
    await Promise.all(
      evaluations
        .filter(
          (evaluation) =>
            !retained.has(evaluation.leftRunId) ||
            !retained.has(evaluation.rightRunId)
        )
        .map((evaluation) =>
          this._options.evaluationRepository.remove(threadId, evaluation.id)
        )
    );
    return this.listRunHistory(threadId);
  }

  async listEvaluationMetadata(
    threadId: string
  ): Promise<StudioEvaluationMetadata> {
    await this._requireThread(threadId);
    const [evaluations, rubrics] = await Promise.all([
      this._options.evaluationRepository.listByThread(threadId),
      this._options.evaluationRubricRepository.listByThread(threadId),
    ]);
    return {
      evaluations: evaluations.toSorted(
        (left, right) =>
          left.createdAt - right.createdAt || left.id.localeCompare(right.id)
      ),
      rubrics: rubrics.toSorted(
        (left, right) =>
          left.createdAt - right.createdAt || left.id.localeCompare(right.id)
      ),
    };
  }

  async saveEvaluationMetadata(
    threadId: string,
    input: StudioEvaluationMetadataInput
  ): Promise<StudioEvaluationMetadata> {
    await this._requireThread(threadId);
    _assertUniqueIds(input.evaluations, "Evaluation");
    _assertUniqueIds(input.rubrics, "Evaluation Rubric");
    const runIds = new Set(
      (await this._options.runIndexRepository.list(threadId)).map(
        (reference) => reference.runId
      )
    );
    const evaluations = input.evaluations.map((evaluation): Evaluation => {
      if (
        evaluation.leftRunId === evaluation.rightRunId ||
        !runIds.has(evaluation.leftRunId) ||
        !runIds.has(evaluation.rightRunId)
      ) {
        throw new Error(
          `Evaluation "${evaluation.id}" must reference two different Runs in Thread "${threadId}".`
        );
      }
      return { ...structuredClone(evaluation), schemaVersion: 1, threadId };
    });
    const rubrics = input.rubrics.map((rubric): EvaluationRubric => ({
      ...structuredClone(rubric),
      schemaVersion: 1,
      threadId,
    }));
    await Promise.all([
      _replaceResources(
        threadId,
        await this._options.evaluationRepository.listByThread(threadId),
        evaluations,
        this._options.evaluationRepository
      ),
      _replaceResources(
        threadId,
        await this._options.evaluationRubricRepository.listByThread(threadId),
        rubrics,
        this._options.evaluationRubricRepository
      ),
    ]);
    return this.listEvaluationMetadata(threadId);
  }

  async forkThread(
    threadId: string,
    input: { readonly checkpointId?: string } = {}
  ): Promise<StudioThread> {
    const source = await this._requireThread(threadId);
    const checkpoint =
      input.checkpointId === undefined
        ? undefined
        : await this._options.checkpointRepository.load(input.checkpointId);
    if (input.checkpointId !== undefined && checkpoint === undefined) {
      throw new Error(`Checkpoint "${input.checkpointId}" was not found.`);
    }
    const executable = await this._options.resolveCurrentAgent?.();
    if (executable === undefined) {
      throw new Error("This Studio host cannot resolve the current Agent.");
    }
    const now = this._clock();
    const document = checkpoint?.document ?? source.document;
    const fork: StudioThread = {
      schemaVersion: 1,
      id: this._generateId("thread"),
      document: {
        ...structuredClone(document),
        title: `${document.title} (Fork)`,
        agent: structuredClone(executable.snapshot),
        commitId: await this._options.revisionProvider.current(),
      },
      provenance: {
        type: "fork",
        threadId,
        ...(input.checkpointId === undefined
          ? {}
          : { checkpointId: input.checkpointId }),
      },
      createdAt: now,
      updatedAt: now,
    };
    if ((await this._options.threadRepository.create(fork)) === "existing") {
      throw new Error(`Studio Thread "${fork.id}" already exists.`);
    }
    for (const reference of await this._options.runIndexRepository.list(
      threadId
    )) {
      await this._options.runIndexRepository.append({
        ...reference,
        threadId: fork.id,
        relation: "inherited",
      });
    }
    return structuredClone(fork);
  }

  async saveDocument(
    threadId: string,
    document: StudioThreadDocument
  ): Promise<StudioThread> {
    const thread = await this._requireThread(threadId);
    if (thread.activeRunId !== undefined) {
      throw new Error(`Studio Thread "${threadId}" is running.`);
    }
    const next = {
      ...thread,
      document: {
        ...structuredClone(document),
        agent: structuredClone(thread.document.agent),
        commitId: thread.document.commitId,
      },
      updatedAt: this._clock(),
    };
    await this._options.threadRepository.save(next);
    return structuredClone(next);
  }

  async run(
    threadId: string,
    input: { readonly fromMessageId: string }
  ): Promise<StudioRunReceipt> {
    const thread = await this._requireThread(threadId);
    if (thread.activeRunId !== undefined) {
      throw new Error(`Studio Thread "${threadId}" is already running.`);
    }
    const currentCommitId = await this._options.revisionProvider.current();
    if (thread.document.commitId !== currentCommitId) {
      throw new StudioThreadOutdatedError(
        thread.document.commitId,
        currentCommitId
      );
    }
    const fromMessageIndex = thread.document.conversation.messages.findIndex(
      (message) => message.id === input.fromMessageId
    );
    if (fromMessageIndex === -1) {
      throw new Error(`Message "${input.fromMessageId}" was not found.`);
    }
    const executable = (await this._options.resolveAgent?.(
      thread.document.agent
    )) ?? { snapshot: thread.document.agent, tools: new Map() };
    const verifiedCommitId = await this._options.revisionProvider.current();
    if (thread.document.commitId !== verifiedCommitId) {
      throw new StudioThreadOutdatedError(
        thread.document.commitId,
        verifiedCommitId
      );
    }

    const now = this._clock();
    const run: Run = {
      schemaVersion: 1,
      id: this._generateId("run"),
      owner: { type: "thread", threadId },
      triggerMessageId: input.fromMessageId,
      status: "queued",
      createdAt: now,
    };
    if ((await this._options.runRepository.create(run)) === "existing") {
      throw new Error(`Run "${run.id}" already exists.`);
    }
    const runningThread = {
      ...thread,
      document: {
        ...thread.document,
        conversation: {
          ...thread.document.conversation,
          messages: thread.document.conversation.messages.slice(
            0,
            fromMessageIndex + 1
          ),
        },
      },
      activeRunId: run.id,
      updatedAt: now,
    };
    const abortController = new AbortController();
    this._abortControllers.set(run.id, abortController);
    try {
      await this._options.threadRepository.save(runningThread);
    } catch (error) {
      this._abortControllers.delete(run.id);
      throw error;
    }
    const execution = this._execute(
      runningThread,
      run,
      executable,
      abortController
    );
    this._executions.set(run.id, execution);
    void execution.catch(() => {
      // _execute persists and publishes its own terminal failure.
    });
    return { runId: run.id };
  }

  async cancelRun(runId: string): Promise<void> {
    const controller = this._abortControllers.get(runId);
    if (controller !== undefined) {
      controller.abort();
      await this._executions.get(runId);
      return;
    }
    const run = await this._options.runRepository.load(runId);
    if (run?.owner.type !== "thread") return;
    const thread = await this._options.threadRepository.load(
      run.owner.threadId
    );
    if (thread?.activeRunId === runId) await this._recoverThread(thread);
  }

  events(
    threadId: string,
    cursor?: StudioEventCursor
  ): AsyncIterable<StudioThreadEvent> {
    return this._options.eventLog.read(threadId, cursor);
  }

  private async _execute(
    thread: StudioThread,
    run: Run,
    executable: ExecutableAgent,
    abortController: AbortController
  ): Promise<void> {
    const startedAt = this._clock();
    let activeRun: Run = { ...run, status: "running", startedAt };
    await this._options.runRepository.save(activeRun);
    await this._emit(thread.id, { type: "run.started", run: activeRun });
    let activeThread = thread;
    try {
      for await (const event of this._options.executor.execute(
        {
          runId: run.id,
          owner: run.owner,
          agent: executable,
          conversation: thread.document.conversation,
        },
        { signal: abortController.signal }
      )) {
        if (abortController.signal.aborted) throw abortController.signal.reason;
        activeThread = _applyRunOutput(activeThread, event);
        await this._options.threadRepository.save(activeThread);
        if (event.type === "message.delta") {
          await this._emit(thread.id, {
            type: "message.delta",
            runId: run.id,
            messageId: event.messageId,
            delta: event.delta,
          });
        } else {
          await this._emit(thread.id, {
            type: "conversation.updated",
            runId: run.id,
            thread: activeThread,
          });
        }
      }

      const checkpointId = this._generateId("checkpoint");
      const completedAt = this._clock();
      const completedThread: StudioThread = {
        ...activeThread,
        activeRunId: undefined,
        updatedAt: completedAt,
      };
      await this._options.checkpointRepository.create({
        schemaVersion: 1,
        id: checkpointId,
        threadId: thread.id,
        source: { type: "run", runId: run.id },
        document: structuredClone(completedThread.document),
        createdAt: completedAt,
      });
      activeRun = {
        ...activeRun,
        status: "completed",
        resultCheckpointId: checkpointId,
        completedAt,
      };
      await this._options.runRepository.save(activeRun);
      await this._options.runIndexRepository.append({
        threadId: thread.id,
        runId: run.id,
        checkpointId,
        relation: "executed",
      });
      await this._options.threadRepository.save(completedThread);
      await this._emit(thread.id, { type: "run.completed", runId: run.id });
    } catch (error) {
      const completedAt = this._clock();
      const cancelled = abortController.signal.aborted;
      await this._options.runRepository.save({
        ...activeRun,
        status: cancelled ? "cancelled" : "failed",
        completedAt,
        ...(cancelled ? {} : { error: { message: _errorMessage(error) } }),
      });
      await this._options.runIndexRepository.append({
        threadId: thread.id,
        runId: run.id,
        relation: "executed",
      });
      await this._options.threadRepository.save({
        ...activeThread,
        activeRunId: undefined,
        updatedAt: completedAt,
      });
      await this._emit(
        thread.id,
        cancelled
          ? { type: "run.cancelled", runId: run.id }
          : { type: "run.failed", runId: run.id, message: _errorMessage(error) }
      );
    } finally {
      this._abortControllers.delete(run.id);
      this._executions.delete(run.id);
    }
  }

  private async _requireThread(threadId: string): Promise<StudioThread> {
    const thread = await this.loadThread(threadId);
    if (thread === undefined) {
      throw new Error(`Studio Thread "${threadId}" was not found.`);
    }
    return thread;
  }

  private _recoverThread(thread: StudioThread): Promise<StudioThread> {
    if (
      thread.activeRunId === undefined ||
      this._abortControllers.has(thread.activeRunId)
    ) {
      return Promise.resolve(thread);
    }
    const existing = this._recoveries.get(thread.id);
    if (existing !== undefined) return existing;
    const recovery = this._recoverInterruptedRun(thread).finally(() => {
      if (this._recoveries.get(thread.id) === recovery) {
        this._recoveries.delete(thread.id);
      }
    });
    this._recoveries.set(thread.id, recovery);
    return recovery;
  }

  private async _recoverInterruptedRun(
    thread: StudioThread
  ): Promise<StudioThread> {
    const runId = thread.activeRunId;
    if (runId === undefined) return thread;
    const run = await this._options.runRepository.load(runId);
    const completedAt = this._clock();
    const recovered = {
      ...thread,
      activeRunId: undefined,
      updatedAt: completedAt,
    };
    let terminalEvent: StudioThreadEvent["event"] | undefined;
    if (run?.status === "queued" || run?.status === "running") {
      await this._options.runRepository.save({
        ...run,
        status: "cancelled",
        completedAt,
      });
      await this._options.runIndexRepository.append({
        threadId: thread.id,
        runId,
        relation: "executed",
      });
      terminalEvent = { type: "run.cancelled", runId };
    } else if (run !== undefined) {
      await this._options.runIndexRepository.append({
        threadId: thread.id,
        runId,
        ...(run.resultCheckpointId === undefined
          ? {}
          : { checkpointId: run.resultCheckpointId }),
        relation: "executed",
      });
      terminalEvent =
        run.status === "completed"
          ? { type: "run.completed", runId }
          : run.status === "failed"
            ? {
                type: "run.failed",
                runId,
                message: run.error?.message ?? "Interrupted Run failed.",
              }
            : { type: "run.cancelled", runId };
    }
    await this._options.threadRepository.save(recovered);
    if (terminalEvent !== undefined) {
      await this._emit(thread.id, terminalEvent);
    }
    return recovered;
  }

  private async _emit(
    threadId: string,
    event: StudioThreadEvent["event"]
  ): Promise<void> {
    let latestSequence = this._eventSequences.get(threadId);
    if (latestSequence === undefined) {
      latestSequence = 0;
      for await (const existing of this._options.eventLog.read(threadId)) {
        latestSequence = Math.max(latestSequence, existing.sequence);
      }
    }
    const sequence = latestSequence + 1;
    this._eventSequences.set(threadId, sequence);
    await this._options.eventLog.append({
      threadId,
      sequence,
      timestamp: this._clock(),
      event,
    });
  }
}

function _assertUniqueIds(
  values: readonly { readonly id: string }[],
  label: string
): void {
  const ids = new Set<string>();
  for (const value of values) {
    if (value.id.trim().length === 0 || ids.has(value.id)) {
      throw new Error(`${label} IDs must be non-empty and unique.`);
    }
    ids.add(value.id);
  }
}

async function _replaceResources<T extends { readonly id: string }>(
  threadId: string,
  current: readonly T[],
  next: readonly T[],
  repository: {
    create(value: T): Promise<"created" | "existing">;
    save(value: T): Promise<void>;
    remove(threadId: string, id: string): Promise<void>;
  }
): Promise<void> {
  const nextIds = new Set(next.map((value) => value.id));
  await Promise.all(
    current
      .filter((value) => !nextIds.has(value.id))
      .map((value) => repository.remove(threadId, value.id))
  );
  await Promise.all(
    next.map(async (value) => {
      if ((await repository.create(value)) === "existing") {
        await repository.save(value);
      }
    })
  );
}

function _applyRunOutput(
  thread: StudioThread,
  event: RunOutputEvent
): StudioThread {
  if (event.type === "message.delta" || event.type === "tool.started") {
    return thread;
  }
  const messages = [...thread.document.conversation.messages];
  if (event.type === "message.completed") {
    const index = messages.findIndex(
      (message) => message.id === event.message.id
    );
    if (index === -1) messages.push(structuredClone(event.message));
    else messages[index] = structuredClone(event.message);
  } else {
    const messageIndex = messages.findIndex(
      (message) =>
        message.id === event.messageId && message.role === "assistant"
    );
    const message = messages[messageIndex];
    if (message?.role === "assistant") {
      messages[messageIndex] = {
        ...message,
        toolCalls: message.toolCalls?.map((call) =>
          call.id === event.toolCallId
            ? { ...call, result: structuredClone(event.result) }
            : call
        ),
      };
    }
  }
  return {
    ...thread,
    document: {
      ...thread.document,
      conversation: { ...thread.document.conversation, messages },
    },
  };
}

function _errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
