import type { Message } from "@llm-space/core";
import type {
  AgentEngine,
  AgentSnapshot,
  ExecutableAgent,
  Run,
  ThreadCheckpoint as EngineCheckpoint,
  ThreadState,
} from "@llm-space/engine";

import type {
  StudioEventCursor,
  StudioExperimentRecord,
  StudioRunHistoryEntry,
  StudioRunInput,
  StudioRunReceipt,
  StudioStepRunInput,
  StudioThread,
  StudioThreadDocument,
  StudioThreadEvent,
  StudioThreadEventData,
  ThreadCheckpoint,
} from "./domain";
import type {
  Evaluation,
  EvaluationRubric,
  StudioEvaluationMetadata,
  StudioEvaluationMetadataInput,
} from "./evaluation";
import type { StudioStore } from "./storage";

export interface SourceRevisionProvider {
  current(): Promise<string>;
  /** Return the revision safe to pin, or undefined for dirty/uncommitted source. */
  binding?(): Promise<string | undefined>;
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

export interface CreateStudioApplicationOptions {
  readonly engine: AgentEngine;
  readonly store: StudioStore;
  readonly revisionProvider: SourceRevisionProvider;
  readonly resolveCurrentAgent?: () => Promise<ExecutableAgent>;
  readonly clock?: () => number;
  readonly generateId?: (prefix: string) => string;
}

export interface CreateStudioThreadInput {
  readonly title?: string;
  readonly agent: AgentSnapshot;
  readonly conversation?: ThreadState;
  readonly provenance?: StudioThread["provenance"];
  readonly commitId?: string;
}

export interface StudioApplication {
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
    input: StudioRunInput
  ): Promise<StudioRunReceipt>;
  stepRun(
    runId: string,
    input?: StudioStepRunInput
  ): Promise<StudioRunReceipt>;
  continueRun(runId: string): Promise<StudioRunReceipt>;
  cancelRun(runId: string): Promise<void>;
  events(
    threadId: string,
    cursor?: StudioEventCursor
  ): AsyncIterable<StudioThreadEvent>;
  close(): Promise<void>;
}

export function createStudioApplication(
  options: CreateStudioApplicationOptions
): StudioApplication {
  return new StudioApplicationImpl(options);
}

class StudioApplicationImpl implements StudioApplication {
  private readonly _clock: () => number;
  private readonly _generateId: (prefix: string) => string;
  private readonly _recovery: Promise<void>;
  private readonly _projections = new Map<string, Promise<void>>();
  private readonly _waiters = new Map<string, Set<() => void>>();
  private _closed = false;
  private _closePromise: Promise<void> | undefined;

  constructor(private readonly _options: CreateStudioApplicationOptions) {
    this._clock = _options.clock ?? Date.now;
    this._generateId =
      _options.generateId ??
      ((prefix) => `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`);
    this._recovery = Promise.resolve().then(() =>
      this._recoverActiveProjections()
    );
    void this._recovery.catch(() => undefined);
  }

  async createThread(input: CreateStudioThreadInput): Promise<StudioThread> {
    await this._recovery;
    const currentCommitId = await this._options.revisionProvider.current();
    if (
      input.commitId !== undefined &&
      input.commitId !== currentCommitId
    ) {
      throw new StudioThreadOutdatedError(input.commitId, currentCommitId);
    }
    const engineThread = await this._options.engine.createThread({
      ...(input.conversation === undefined
        ? {}
        : { initialState: input.conversation }),
    });
    const now = this._clock();
    const experiment: StudioExperimentRecord = {
      schemaVersion: 1,
      id: this._generateId("experiment"),
      engineThreadId: engineThread.id,
      title: input.title?.trim() || "New Thread",
      agent: structuredClone(input.agent),
      ...(input.commitId === undefined ? {} : { commitId: input.commitId }),
      ...(input.provenance === undefined
        ? {}
        : { provenance: structuredClone(input.provenance) }),
      createdAt: now,
      updatedAt: now,
    };
    this._options.store.transaction((tx) => tx.insertExperiment(experiment));
    return this._composeThread(experiment);
  }

  async loadThread(threadId: string): Promise<StudioThread | undefined> {
    await this._recovery;
    const experiment = this._options.store.transaction((tx) =>
      tx.getExperiment(threadId)
    );
    return experiment === undefined
      ? undefined
      : this._composeThread(experiment);
  }

  async listThreads(): Promise<readonly StudioThread[]> {
    await this._recovery;
    const experiments = this._options.store.transaction((tx) =>
      tx.listExperiments()
    );
    return Promise.all(
      experiments.map((experiment) => this._composeThread(experiment))
    );
  }

  async listRunHistory(
    threadId: string
  ): Promise<readonly StudioRunHistoryEntry[]> {
    await this._recovery;
    const experiment = this._requireExperiment(threadId);
    const references = this._options.store.transaction((tx) =>
      tx.listRunReferences(threadId)
    );
    const entries = await Promise.all(
      references.map(
        async (reference): Promise<StudioRunHistoryEntry | undefined> => {
          const run = await this._options.engine.getRun(reference.runId);
          if (run === undefined) return undefined;
          const checkpointId = run.resultCheckpointId ?? reference.checkpointId;
          const checkpoint =
            checkpointId === undefined
              ? undefined
              : await this._checkpointView(experiment, checkpointId);
          return {
            reference: {
              ...reference,
              ...(checkpointId === undefined ? {} : { checkpointId }),
            },
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
    await this._recovery;
    this._requireExperiment(threadId);
    _assertUniqueIds(
      runIds.map((id) => ({ id })),
      "Run"
    );
    this._options.store.transaction((tx) => {
      const current = tx.listRunReferences(threadId);
      const byId = new Map(
        current.map((reference) => [reference.runId, reference])
      );
      const next = runIds.map((runId) => {
        const reference = byId.get(runId);
        if (reference === undefined) {
          throw new Error(
            `Run "${runId}" does not belong to Studio Thread "${threadId}".`
          );
        }
        return reference;
      });
      tx.replaceRunReferences(threadId, next);
      const retained = new Set(runIds);
      tx.replaceEvaluations(
        threadId,
        tx
          .listEvaluations(threadId)
          .filter(
            (evaluation) =>
              retained.has(evaluation.leftRunId) &&
              retained.has(evaluation.rightRunId)
          )
      );
    });
    return this.listRunHistory(threadId);
  }

  async listEvaluationMetadata(
    threadId: string
  ): Promise<StudioEvaluationMetadata> {
    await this._recovery;
    this._requireExperiment(threadId);
    return this._options.store.transaction((tx) => ({
      evaluations: tx.listEvaluations(threadId),
      rubrics: tx.listRubrics(threadId),
    }));
  }

  async saveEvaluationMetadata(
    threadId: string,
    input: StudioEvaluationMetadataInput
  ): Promise<StudioEvaluationMetadata> {
    await this._recovery;
    this._requireExperiment(threadId);
    _assertUniqueIds(input.evaluations, "Evaluation");
    _assertUniqueIds(input.rubrics, "Evaluation Rubric");
    const metadata = this._options.store.transaction((tx) => {
      const runIds = new Set(
        tx.listRunReferences(threadId).map((reference) => reference.runId)
      );
      const evaluations = input.evaluations.map((evaluation): Evaluation => {
        if (
          evaluation.leftRunId === evaluation.rightRunId ||
          !runIds.has(evaluation.leftRunId) ||
          !runIds.has(evaluation.rightRunId)
        ) {
          throw new Error(
            `Evaluation "${evaluation.id}" must reference two different Runs in Studio Thread "${threadId}".`
          );
        }
        return { ...structuredClone(evaluation), schemaVersion: 1, threadId };
      });
      const rubrics = input.rubrics.map((rubric): EvaluationRubric => ({
        ...structuredClone(rubric),
        schemaVersion: 1,
        threadId,
      }));
      tx.replaceEvaluations(threadId, evaluations);
      tx.replaceRubrics(threadId, rubrics);
      return { evaluations, rubrics };
    });
    return metadata;
  }

  async forkThread(
    threadId: string,
    input: { readonly checkpointId?: string } = {}
  ): Promise<StudioThread> {
    await this._recovery;
    const source = this._requireExperiment(threadId);
    const currentAgent = await this._options.resolveCurrentAgent?.();
    if (currentAgent === undefined) {
      throw new Error("This Studio host cannot resolve the current Agent.");
    }
    const fork = await this._options.engine.forkThread({
      threadId: source.engineThreadId,
      ...(input.checkpointId === undefined
        ? {}
        : { checkpointId: input.checkpointId }),
    });
    if (source.draft !== undefined && input.checkpointId === undefined) {
      await this._replaceThreadState(fork.id, source.draft);
    }
    const binding = await this._options.revisionProvider.binding?.();
    const now = this._clock();
    const experiment: StudioExperimentRecord = {
      schemaVersion: 1,
      id: this._generateId("experiment"),
      engineThreadId: fork.id,
      title: `${source.title} (Fork)`,
      agent: structuredClone(currentAgent.snapshot),
      ...(binding === undefined ? {} : { commitId: binding }),
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
    this._options.store.transaction((tx) => {
      tx.insertExperiment(experiment);
      tx.replaceRunReferences(
        experiment.id,
        tx.listRunReferences(threadId).map((reference) => ({
          ...reference,
          threadId: experiment.id,
          relation: "inherited",
        }))
      );
    });
    return this._composeThread(experiment);
  }

  async saveDocument(
    threadId: string,
    document: StudioThreadDocument
  ): Promise<StudioThread> {
    await this._recovery;
    const experiment = this._requireExperiment(threadId);
    const active = await this._activeRun(experiment.engineThreadId);
    if (active !== undefined) {
      throw new Error(`Studio Thread "${threadId}" is running.`);
    }
    const next: StudioExperimentRecord = {
      ...experiment,
      title: document.title.trim() || experiment.title,
      draft: structuredClone(document.conversation),
      updatedAt: this._clock(),
    };
    this._options.store.transaction((tx) => tx.saveExperiment(next));
    return this._composeThread(next);
  }

  async run(
    threadId: string,
    input: StudioRunInput
  ): Promise<StudioRunReceipt> {
    await this._recovery;
    let experiment = this._requireExperiment(threadId);
    const currentCommitId = await this._options.revisionProvider.current();
    if (
      experiment.commitId !== undefined &&
      experiment.commitId !== currentCommitId
    ) {
      throw new StudioThreadOutdatedError(experiment.commitId, currentCommitId);
    }
    if (experiment.commitId === undefined) {
      const currentAgent = await this._options.resolveCurrentAgent?.();
      if (currentAgent === undefined) {
        throw new Error("This Studio host cannot resolve the current Agent.");
      }
      experiment = {
        ...experiment,
        agent: structuredClone(currentAgent.snapshot),
        updatedAt: this._clock(),
      };
      this._options.store.transaction((tx) => tx.saveExperiment(experiment));
    }
    const view = await this._composeThread(experiment);
    if (view.activeRunId !== undefined) {
      throw new Error(`Studio Thread "${threadId}" is already running.`);
    }
    const messages = view.document.conversation.messages;
    const inputIndex = messages.findIndex(
      (message) => message.id === input.fromMessageId
    );
    if (inputIndex === -1) {
      throw new Error(`Message "${input.fromMessageId}" was not found.`);
    }
    const inputMessage = messages[inputIndex];
    if (inputMessage?.role !== "user") {
      throw new Error("A Studio Run must start from a user Message.");
    }
    const desiredBase: ThreadState = {
      messages: messages.slice(0, inputIndex),
      state: structuredClone(view.document.conversation.state),
    };
    const retryOf = await this._findRetryRun(
      threadId,
      inputMessage,
      desiredBase,
      experiment.commitId !== undefined
    );
    if (retryOf !== undefined) {
      const operationId = this._generateId("operation");
      experiment = this._stageRunIntent(experiment, operationId);
      let retry: Run;
      try {
        retry = await this._options.engine.retryRun({
          runId: retryOf.id,
          ...(input.mode === undefined ? {} : { mode: input.mode }),
          operationId,
        });
      } catch (error) {
        this._clearRunIntent(threadId, operationId);
        throw error;
      }
      experiment = {
        ...experiment,
        engineThreadId: retry.threadId,
        updatedAt: this._clock(),
      };
      this._recordRun(threadId, experiment, retry);
      return { runId: retry.id };
    }
    const target = await this._prepareRunThread(experiment, desiredBase);
    if (target.id !== experiment.engineThreadId) {
      experiment = {
        ...experiment,
        engineThreadId: target.id,
        updatedAt: this._clock(),
      };
    }
    const operationId = this._generateId("operation");
    experiment = this._stageRunIntent(experiment, operationId);
    let run: Run;
    try {
      run = await this._options.engine.startRun({
        threadId: target.id,
        expectedHeadCheckpointId: target.headCheckpointId,
        inputMessages: [inputMessage],
        agentSnapshot: experiment.agent,
        ...(input.mode === undefined ? {} : { mode: input.mode }),
        operationId,
      });
    } catch (error) {
      this._clearRunIntent(threadId, operationId);
      throw error;
    }
    this._recordRun(threadId, experiment, run);
    return { runId: run.id };
  }

  /** Execute one model or selected tool step on the same paused Run. */
  async stepRun(
    runId: string,
    input: StudioStepRunInput = {}
  ): Promise<StudioRunReceipt> {
    await this._recovery;
    const threadId = this._requireRunThreadId(runId);
    const run = await this._options.engine.stepRun({ runId, ...input });
    this._scheduleProjection(threadId, run.id);
    return { runId: run.id };
  }

  /** Continue the same paused Run until it completes or pauses again. */
  async continueRun(runId: string): Promise<StudioRunReceipt> {
    await this._recovery;
    const threadId = this._requireRunThreadId(runId);
    const run = await this._options.engine.continueRun(runId);
    this._scheduleProjection(threadId, run.id);
    return { runId: run.id };
  }

  private _recordRun(
    threadId: string,
    experiment: StudioExperimentRecord,
    run: Run
  ): void {
    const now = this._clock();
    this._options.store.transaction((tx) => {
      const references = [...tx.listRunReferences(threadId)];
      references.push({ threadId, runId: run.id, relation: "executed" });
      tx.replaceRunReferences(threadId, references);
      tx.saveExperiment({
        ...experiment,
        draft: undefined,
        pendingRun: undefined,
        updatedAt: now,
      });
    });
    this._emit(threadId, { type: "run.started", run });
    this._scheduleProjection(threadId, run.id);
  }

  private _stageRunIntent(
    experiment: StudioExperimentRecord,
    operationId: string
  ): StudioExperimentRecord {
    const staged: StudioExperimentRecord = {
      ...experiment,
      pendingRun: { operationId, createdAt: this._clock() },
      updatedAt: this._clock(),
    };
    this._options.store.transaction((tx) => tx.saveExperiment(staged));
    return staged;
  }

  private _clearRunIntent(threadId: string, operationId: string): void {
    this._options.store.transaction((tx) => {
      const experiment = tx.getExperiment(threadId);
      if (experiment?.pendingRun?.operationId !== operationId) return;
      tx.saveExperiment({
        ...experiment,
        pendingRun: undefined,
        updatedAt: this._clock(),
      });
    });
  }

  async cancelRun(runId: string): Promise<void> {
    await this._recovery;
    await this._options.engine.cancelRun(runId);
  }

  async *events(
    threadId: string,
    cursor: StudioEventCursor = {}
  ): AsyncIterable<StudioThreadEvent> {
    await this._recovery;
    this._requireExperiment(threadId);
    let afterSequence = cursor.afterSequence ?? 0;
    while (!cursor.signal?.aborted) {
      const events = this._options.store.transaction((tx) =>
        tx.listEvents(threadId, afterSequence)
      );
      if (events.length > 0) {
        for (const event of events) {
          afterSequence = event.sequence;
          yield event;
        }
        continue;
      }
      if (cursor.follow !== true) return;
      await this._waitForEvent(threadId, cursor.signal);
    }
  }

  close(): Promise<void> {
    this._closePromise ??= this._close();
    return this._closePromise;
  }

  private async _close(): Promise<void> {
    this._closed = true;
    try {
      // Recovery owns short-lived Engine reads. Wait for it to observe
      // `_closed` before closing either dependency.
      await Promise.allSettled([this._recovery]);
      await this._options.engine.close();
      await Promise.allSettled(this._projections.values());
    } finally {
      try {
        this._options.store.close();
      } finally {
        this._notify();
      }
    }
  }

  private async _composeThread(
    experiment: StudioExperimentRecord
  ): Promise<StudioThread> {
    const engineThread = await this._options.engine.getThread(
      experiment.engineThreadId
    );
    if (engineThread === undefined) {
      throw new Error(
        `Engine Thread "${experiment.engineThreadId}" was not found.`
      );
    }
    const checkpoint = await this._options.engine.getCheckpoint(
      engineThread.headCheckpointId
    );
    if (checkpoint === undefined) {
      throw new Error(
        `Checkpoint "${engineThread.headCheckpointId}" was not found.`
      );
    }
    const activeRun = await this._activeRun(engineThread.id);
    return {
      schemaVersion: 1,
      id: experiment.id,
      engineThreadId: engineThread.id,
      headCheckpointId: engineThread.headCheckpointId,
      document: {
        title: experiment.title,
        agent: structuredClone(experiment.agent),
        conversation: structuredClone(
          experiment.draft ?? checkpoint.threadState
        ),
        ...(experiment.commitId === undefined
          ? {}
          : { commitId: experiment.commitId }),
      },
      ...(experiment.provenance === undefined
        ? {}
        : { provenance: structuredClone(experiment.provenance) }),
      ...(activeRun === undefined ? {} : { activeRunId: activeRun.id }),
      createdAt: experiment.createdAt,
      updatedAt: experiment.updatedAt,
    };
  }

  private async _prepareRunThread(
    experiment: StudioExperimentRecord,
    desiredBase: ThreadState
  ) {
    const current = await this._options.engine.getThread(
      experiment.engineThreadId
    );
    if (current === undefined) {
      throw new Error(
        `Engine Thread "${experiment.engineThreadId}" was not found.`
      );
    }
    const head = await this._options.engine.getCheckpoint(
      current.headCheckpointId
    );
    if (head === undefined)
      throw new Error(
        `Checkpoint "${current.headCheckpointId}" was not found.`
      );
    if (_sameState(head.threadState, desiredBase)) return current;

    const checkpoints = await this._options.engine.listCheckpoints(current.id);
    const matching = checkpoints.findLast((checkpoint) =>
      _sameState(checkpoint.threadState, desiredBase)
    );
    const child = await this._options.engine.forkThread({
      threadId: current.id,
      ...(matching === undefined ? {} : { checkpointId: matching.id }),
    });
    if (matching !== undefined) return child;
    const checkpoint = await this._replaceThreadState(child.id, desiredBase);
    return {
      ...child,
      headCheckpointId: checkpoint.id,
      updatedAt: checkpoint.createdAt,
    };
  }

  private async _findRetryRun(
    experimentId: string,
    inputMessage: Extract<Message, { role: "user" }>,
    desiredBase: ThreadState,
    allowSourceRetry: boolean
  ): Promise<Run | undefined> {
    // An unbound Experiment deliberately executes whatever source exists now.
    // Retrying an old immutable Run would pin its old AgentSnapshot instead.
    if (!allowSourceRetry) return undefined;
    const references = this._options.store.transaction((tx) =>
      tx.listRunReferences(experimentId)
    );
    for (const reference of references.toReversed()) {
      if (reference.relation !== "executed") continue;
      const run = await this._options.engine.getRun(reference.runId);
      if (
        run === undefined ||
        JSON.stringify(run.inputMessages) !== JSON.stringify([inputMessage])
      ) {
        continue;
      }
      const base = await this._options.engine.getCheckpoint(
        run.baseCheckpointId
      );
      if (base !== undefined && _sameState(base.threadState, desiredBase)) {
        return run;
      }
    }
    return undefined;
  }

  private async _replaceThreadState(threadId: string, state: ThreadState) {
    const thread = await this._options.engine.getThread(threadId);
    if (thread === undefined)
      throw new Error(`Engine Thread "${threadId}" was not found.`);
    return this._options.engine.commitThreadState({
      threadId,
      expectedHeadCheckpointId: thread.headCheckpointId,
      threadState: state,
    });
  }

  private async _checkpointView(
    experiment: StudioExperimentRecord,
    checkpointId: string
  ): Promise<ThreadCheckpoint | undefined> {
    const checkpoint = await this._options.engine.getCheckpoint(checkpointId);
    if (checkpoint === undefined) return undefined;
    return _checkpointView(experiment, checkpoint);
  }

  private async _activeRun(engineThreadId: string): Promise<Run | undefined> {
    return (await this._options.engine.listRuns(engineThreadId)).find(
      (run) =>
        run.status === "queued" ||
        run.status === "running" ||
        run.status === "paused"
    );
  }

  /** Resolve Studio ownership without leaking Engine Thread ids to callers. */
  private _requireRunThreadId(runId: string): string {
    const experiment = this._options.store.transaction((tx) =>
      tx
        .listExperiments()
        .find((candidate) =>
          tx
            .listRunReferences(candidate.id)
            .some((reference) => reference.runId === runId)
        )
    );
    if (experiment === undefined) {
      throw new Error(`Run "${runId}" does not belong to this Studio.`);
    }
    return experiment.id;
  }

  private _requireExperiment(threadId: string): StudioExperimentRecord {
    const experiment = this._options.store.transaction((tx) =>
      tx.getExperiment(threadId)
    );
    if (experiment === undefined) {
      throw new Error(`Studio Thread "${threadId}" was not found.`);
    }
    return experiment;
  }

  private _scheduleProjection(threadId: string, runId: string): void {
    if (this._closed || this._projections.has(runId)) return;
    const projection = this._projectRun(threadId, runId).finally(() => {
      this._projections.delete(runId);
    });
    this._projections.set(runId, projection);
    void projection.catch((error: unknown) => {
      this._emit(threadId, {
        type: "run.failed",
        runId,
        message: _errorMessage(error),
      });
    });
  }

  private async _projectRun(threadId: string, runId: string): Promise<void> {
    for await (const frame of this._options.engine.streamRun(runId, {
      follow: true,
    })) {
      if (frame.type === "snapshot") {
        for (const output of frame.outputs) {
          if (output.status !== "streaming") continue;
          const text = _messageText(output.message);
          if (text.length > 0) {
            this._emit(threadId, {
              type: "message.delta",
              runId,
              messageId: output.message.id,
              delta: text,
            });
          }
        }
        if (_isTerminal(frame.run.status)) {
          await this._emitTerminal(threadId, frame.run);
        } else if (frame.run.status === "paused") {
          this._emit(threadId, { type: "run.paused", run: frame.run });
        }
        continue;
      }
      if (
        frame.event.type === "message.delta" ||
        frame.event.type === "thinking.delta" ||
        frame.event.type === "message.completed" ||
        frame.event.type === "tool.started" ||
        frame.event.type === "tool.updated" ||
        frame.event.type === "tool.completed"
      ) {
        this._emit(threadId, { ...frame.event, runId });
      } else if (frame.event.type === "checkpoint.committed") {
        const thread = await this.loadThread(threadId);
        if (thread !== undefined) {
          this._emit(threadId, { type: "conversation.updated", runId, thread });
        }
      } else if (frame.event.type === "run.updated") {
        if (frame.event.run.status === "paused") {
          this._emit(threadId, {
            type: "run.paused",
            run: frame.event.run,
          });
        } else if (_isTerminal(frame.event.run.status)) {
          await this._emitTerminal(threadId, frame.event.run);
        }
      }
    }
  }

  private async _emitTerminal(threadId: string, run: Run): Promise<void> {
    const experiment = this._requireExperiment(threadId);
    this._options.store.transaction((tx) => {
      const references = tx
        .listRunReferences(threadId)
        .map((reference) =>
          reference.runId === run.id && run.resultCheckpointId !== undefined
            ? { ...reference, checkpointId: run.resultCheckpointId }
            : reference
        );
      tx.replaceRunReferences(threadId, references);
      tx.saveExperiment({
        ...experiment,
        updatedAt: this._clock(),
      });
    });
    const thread = await this.loadThread(threadId);
    if (thread !== undefined) {
      this._emit(threadId, {
        type: "conversation.updated",
        runId: run.id,
        thread,
      });
    }
    if (run.status === "completed") {
      this._emit(threadId, { type: "run.completed", runId: run.id });
    } else if (run.status === "cancelled") {
      this._emit(threadId, { type: "run.cancelled", runId: run.id });
    } else {
      this._emit(threadId, {
        type: "run.failed",
        runId: run.id,
        message: run.error?.message ?? `Run ended as ${run.status}.`,
      });
    }
  }

  private _emit(threadId: string, event: StudioThreadEventData): void {
    this._options.store.transaction((tx) => {
      tx.appendEvent({ threadId, timestamp: this._clock(), event });
    });
    this._notify(threadId);
  }

  private _waitForEvent(threadId: string, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.resolve();
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
    });
  }

  private _notify(threadId?: string): void {
    const entries =
      threadId === undefined
        ? [...this._waiters.values()]
        : [this._waiters.get(threadId) ?? new Set()];
    if (threadId === undefined) this._waiters.clear();
    else this._waiters.delete(threadId);
    for (const waiters of entries) for (const wake of waiters) wake();
  }

  private async _recoverActiveProjections(): Promise<void> {
    if (this._closed) return;
    for (let experiment of this._options.store.transaction((tx) =>
      tx.listExperiments()
    )) {
      if (experiment.pendingRun !== undefined) {
        const run = await this._options.engine.getRunByOperationId(
          experiment.pendingRun.operationId
        );
        if (run === undefined) {
          this._clearRunIntent(
            experiment.id,
            experiment.pendingRun.operationId
          );
        } else {
          experiment = { ...experiment, engineThreadId: run.threadId };
          this._recordRun(experiment.id, experiment, run);
        }
      }
      const active = await this._activeRun(experiment.engineThreadId);
      if (active !== undefined)
        this._scheduleProjection(experiment.id, active.id);
    }
  }
}

function _checkpointView(
  experiment: StudioExperimentRecord,
  checkpoint: EngineCheckpoint
): ThreadCheckpoint {
  return {
    schemaVersion: 1,
    id: checkpoint.id,
    threadId: experiment.id,
    source: checkpoint.source,
    document: {
      title: experiment.title,
      agent: structuredClone(experiment.agent),
      conversation: structuredClone(checkpoint.threadState),
      ...(experiment.commitId === undefined
        ? {}
        : { commitId: experiment.commitId }),
    },
    createdAt: checkpoint.createdAt,
  };
}

function _sameState(left: ThreadState, right: ThreadState): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function _messageText(
  message: Extract<Message, { role: "assistant" }>
): string {
  return message.content.map((content) => content.text).join("\n");
}

function _isTerminal(status: Run["status"]): boolean {
  return (
    status === "completed" ||
    status === "failed" ||
    status === "cancelled" ||
    status === "interrupted"
  );
}

function _assertUniqueIds(
  values: readonly { readonly id: string }[],
  label: string
): void {
  const ids = new Set<string>();
  for (const value of values) {
    if (ids.has(value.id))
      throw new Error(`${label} "${value.id}" is duplicated.`);
    ids.add(value.id);
  }
}

function _errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
