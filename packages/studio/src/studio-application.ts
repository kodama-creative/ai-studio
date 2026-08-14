import type {
  PiOperationSnapshot,
  PiSessionSnapshot,
  RuntimeBinding,
  StudioPiSessionRuntime,
} from "@llm-space/pi-runtime";

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
} from "./domain";
import type {
  Evaluation,
  EvaluationRubric,
  StudioEvaluationMetadata,
  StudioEvaluationMetadataInput,
} from "./evaluation";
import {
  STUDIO_PI_LANE,
  STUDIO_PI_RUNTIME_FORMAT_VERSION,
  type StudioAgentSnapshot,
  type StudioConversation,
  type StudioExecutableAgent,
  type StudioOperationReference,
} from "./pi-domain";
import {
  coreMessagesToPi,
  piEntriesToCoreMessages,
} from "./pi-message-projection";
import type { StudioStore } from "./storage";

export interface CreateStudioApplicationOptions {
  readonly runtime: StudioPiSessionRuntime;
  readonly store: StudioStore;
  /** Loads current project source for every newly admitted operation. */
  readonly resolveCurrentAgent: () => Promise<StudioExecutableAgent>;
  readonly clock?: () => number;
  readonly generateId?: (prefix: string) => string;
}

export interface CreateStudioThreadInput {
  readonly title?: string;
  readonly agent: StudioAgentSnapshot;
  readonly conversation?: StudioConversation;
  readonly provenance?: StudioThread["provenance"];
}

export interface StudioApplication {
  createThread(input: CreateStudioThreadInput): Promise<StudioThread>;
  loadThread(threadId: string): Promise<StudioThread | undefined>;
  listThreads(): Promise<readonly StudioThread[]>;
  listRunHistory(threadId: string): Promise<readonly StudioRunHistoryEntry[]>;
  saveRunHistory(
    threadId: string,
    operationIds: readonly string[]
  ): Promise<readonly StudioRunHistoryEntry[]>;
  listEvaluationMetadata(threadId: string): Promise<StudioEvaluationMetadata>;
  saveEvaluationMetadata(
    threadId: string,
    input: StudioEvaluationMetadataInput
  ): Promise<StudioEvaluationMetadata>;
  forkThread(
    threadId: string,
    input?: { readonly entryId?: string }
  ): Promise<StudioThread>;
  saveDocument(
    threadId: string,
    document: StudioThreadDocument
  ): Promise<StudioThread>;
  run(threadId: string, input: StudioRunInput): Promise<StudioRunReceipt>;
  stepRun(
    operationId: string,
    input: StudioStepRunInput
  ): Promise<StudioRunReceipt>;
  continueRun(operationId: string): Promise<StudioRunReceipt>;
  cancelRun(operationId: string): Promise<void>;
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
  private readonly _waiters = new Map<string, Set<() => void>>();
  private _closed = false;

  constructor(private readonly _options: CreateStudioApplicationOptions) {
    this._clock = _options.clock ?? Date.now;
    this._generateId =
      _options.generateId ??
      ((prefix) => `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`);
  }

  /** Creates one Project Experiment backed by one authoritative Pi Session. */
  async createThread(input: CreateStudioThreadInput): Promise<StudioThread> {
    this._requireOpen();
    const session = await this._options.runtime.createSession();
    const now = this._clock();
    const experiment: StudioExperimentRecord = {
      schemaVersion: 1,
      id: this._generateId("experiment"),
      sessionId: session.sessionId,
      lane: STUDIO_PI_LANE,
      runtimeFormatVersion: STUDIO_PI_RUNTIME_FORMAT_VERSION,
      title: input.title?.trim() || "New Thread",
      agent: structuredClone(input.agent),
      state: structuredClone(input.conversation?.state ?? {}),
      ...(input.conversation === undefined
        ? {}
        : { draft: structuredClone(input.conversation) }),
      ...(input.provenance === undefined
        ? {}
        : { provenance: structuredClone(input.provenance) }),
      createdAt: now,
      updatedAt: now,
    };
    this._options.store.transaction((tx) => tx.insertExperiment(experiment));
    return this._composeThread(experiment, session);
  }

  /** Rebuilds one Experiment view from Studio metadata and committed Pi entries. */
  async loadThread(threadId: string): Promise<StudioThread | undefined> {
    this._requireOpen();
    const experiment = this._options.store.transaction((tx) =>
      tx.getExperiment(threadId)
    );
    return experiment === undefined
      ? undefined
      : this._composeThread(experiment);
  }

  /** Lists Project Experiments without reading or migrating Engine state. */
  async listThreads(): Promise<readonly StudioThread[]> {
    this._requireOpen();
    const experiments = this._options.store.transaction((tx) =>
      tx.listExperiments()
    );
    return Promise.all(
      experiments.map((experiment) => this._composeThread(experiment))
    );
  }

  /** Resolves Studio ordering references into Pi operation detail projections. */
  async listRunHistory(
    threadId: string
  ): Promise<readonly StudioRunHistoryEntry[]> {
    this._requireOpen();
    const experiment = this._requireExperiment(threadId);
    const references = this._options.store.transaction((tx) =>
      tx.listOperationReferences(threadId)
    );
    const bySession = new Map<string, readonly PiOperationSnapshot[]>();
    const history: StudioRunHistoryEntry[] = [];
    for (const reference of references) {
      let operations = bySession.get(reference.sessionId);
      if (operations === undefined) {
        operations = await this._options.runtime.listOperations({
          sessionId: reference.sessionId,
          lane: reference.lane,
        });
        bySession.set(reference.sessionId, operations);
      }
      const operation = operations.find(
        (candidate) => candidate.operationId === reference.operationId
      );
      if (operation === undefined) continue;
      const document: StudioThreadDocument = {
        title: experiment.title,
        agent: structuredClone(reference.agentSnapshot),
        conversation: {
          messages: piEntriesToCoreMessages(operation.conversationEntries),
          state: structuredClone(experiment.state),
        },
      };
      history.push({
        reference,
        operation,
        ...(operation.leafId === null
          ? {}
          : {
              checkpoint: {
                schemaVersion: 1,
                id: operation.leafId,
                sessionId: operation.sessionId,
                operationId: operation.operationId,
                document,
                createdAt: operation.finishedAt ?? operation.startedAt,
              },
            }),
      });
    }
    return history;
  }

  /** Reorders/removes Studio references without deleting any Pi operation log. */
  async saveRunHistory(
    threadId: string,
    operationIds: readonly string[]
  ): Promise<readonly StudioRunHistoryEntry[]> {
    this._requireOpen();
    this._requireExperiment(threadId);
    _assertUniqueIds(
      operationIds.map((id) => ({ id })),
      "Operation"
    );
    this._options.store.transaction((tx) => {
      const current = tx.listOperationReferences(threadId);
      const byId = new Map(
        current.map((reference) => [reference.operationId, reference])
      );
      const next = operationIds.map((operationId) => {
        const reference = byId.get(operationId);
        if (reference === undefined) {
          throw new Error(
            `Operation "${operationId}" does not belong to Studio Thread "${threadId}".`
          );
        }
        return reference;
      });
      tx.replaceOperationReferences(threadId, next);
      const retained = new Set(operationIds);
      tx.replaceEvaluations(
        threadId,
        tx
          .listEvaluations(threadId)
          .filter(
            (evaluation) =>
              retained.has(evaluation.leftOperationId) &&
              retained.has(evaluation.rightOperationId)
          )
      );
    });
    return this.listRunHistory(threadId);
  }

  /** Returns Studio-owned evaluation metadata over Pi operation identities. */
  listEvaluationMetadata(
    threadId: string
  ): Promise<StudioEvaluationMetadata> {
    this._requireOpen();
    this._requireExperiment(threadId);
    return Promise.resolve(
      this._options.store.transaction((tx) => ({
        evaluations: tx.listEvaluations(threadId),
        rubrics: tx.listRubrics(threadId),
      }))
    );
  }

  /** Validates evaluation targets against this Experiment's operation index. */
  saveEvaluationMetadata(
    threadId: string,
    input: StudioEvaluationMetadataInput
  ): Promise<StudioEvaluationMetadata> {
    this._requireOpen();
    this._requireExperiment(threadId);
    _assertUniqueIds(input.evaluations, "Evaluation");
    _assertUniqueIds(input.rubrics, "Evaluation Rubric");
    return Promise.resolve(this._options.store.transaction((tx) => {
      const operationIds = new Set(
        tx
          .listOperationReferences(threadId)
          .map((reference) => reference.operationId)
      );
      const evaluations = input.evaluations.map((evaluation): Evaluation => {
        if (
          evaluation.leftOperationId === evaluation.rightOperationId ||
          !operationIds.has(evaluation.leftOperationId) ||
          !operationIds.has(evaluation.rightOperationId)
        ) {
          throw new Error(
            `Evaluation "${evaluation.id}" must reference two different operations in Studio Thread "${threadId}".`
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
    }));
  }

  /** Forks a Pi branch and preserves inherited operation ordering references. */
  async forkThread(
    threadId: string,
    input: { readonly entryId?: string } = {}
  ): Promise<StudioThread> {
    this._requireOpen();
    const source = this._requireExperiment(threadId);
    const currentAgent = await this._options.resolveCurrentAgent();
    const fork = await this._options.runtime.forkSession({
      sessionId: source.sessionId,
      ...(input.entryId === undefined ? {} : { entryId: input.entryId }),
    });
    const now = this._clock();
    const experiment: StudioExperimentRecord = {
      schemaVersion: 1,
      id: this._generateId("experiment"),
      sessionId: fork.sessionId,
      lane: STUDIO_PI_LANE,
      runtimeFormatVersion: STUDIO_PI_RUNTIME_FORMAT_VERSION,
      title: `${source.title} (Fork)`,
      agent: structuredClone(currentAgent.snapshot),
      state: structuredClone(source.state),
      ...(source.draft === undefined || input.entryId !== undefined
        ? {}
        : { draft: structuredClone(source.draft) }),
      provenance: {
        type: "fork",
        threadId,
        ...(input.entryId === undefined ? {} : { entryId: input.entryId }),
      },
      createdAt: now,
      updatedAt: now,
    };
    this._options.store.transaction((tx) => {
      tx.insertExperiment(experiment);
      const references = tx.listOperationReferences(threadId);
      const inherited =
        input.entryId === undefined
          ? references
          : references.slice(
              0,
              references.findIndex(
                (reference) => reference.leafId === input.entryId
              ) + 1
            );
      tx.replaceOperationReferences(
        experiment.id,
        inherited.map((reference) => ({
          ...reference,
          relation: "inherited",
        }))
      );
    });
    return this._composeThread(experiment, fork);
  }

  /** Saves a dirty editable Draft without mutating the Pi Session branch. */
  async saveDocument(
    threadId: string,
    document: StudioThreadDocument
  ): Promise<StudioThread> {
    this._requireOpen();
    const experiment = this._requireExperiment(threadId);
    const snapshot = await this._options.runtime.open({
      sessionId: experiment.sessionId,
      lane: experiment.lane,
    });
    if (_hasActiveOperation(snapshot)) {
      throw new Error(`Studio Thread "${threadId}" has an active operation.`);
    }
    const next: StudioExperimentRecord = {
      ...experiment,
      title: document.title.trim() || experiment.title,
      draft: structuredClone(document.conversation),
      updatedAt: this._clock(),
    };
    this._options.store.transaction((tx) => tx.saveExperiment(next));
    return this._composeThread(next, snapshot);
  }

  /** Admits one Pi operation, clears the Draft, then applies the requested drive mode. */
  async run(
    threadId: string,
    input: StudioRunInput
  ): Promise<StudioRunReceipt> {
    this._requireOpen();
    let experiment = this._requireExperiment(threadId);
    const view = await this._composeThread(experiment);
    if (view.operationId !== undefined) {
      throw new Error(`Studio Thread "${threadId}" has an active operation.`);
    }
    const currentAgent = await this._options.resolveCurrentAgent();
    const effectiveAgent: StudioAgentSnapshot = {
      ...structuredClone(currentAgent.snapshot),
      ...(input.modelOverride === undefined
        ? {}
        : { model: input.modelOverride }),
    };
    const messages = view.document.conversation.messages;
    const inputIndex = messages.findIndex(
      (message) => message.id === input.fromMessageId
    );
    const inputMessage = messages[inputIndex];
    if (inputMessage?.role !== "user") {
      throw new Error(
        `Studio operation input "${input.fromMessageId}" must be a user Message.`
      );
    }
    const prepared = await this._prepareSession(experiment, {
      messages: messages.slice(0, inputIndex),
      state: structuredClone(view.document.conversation.state),
    });
    experiment = prepared.experiment;
    const operationId = this._generateId("operation");
    const binding = _runtimeBinding(effectiveAgent);
    let snapshot = await this._options.runtime.start({
      operationId,
      sessionId: experiment.sessionId,
      lane: experiment.lane,
      messages: coreMessagesToPi(
        [...prepared.baseMessages, inputMessage],
        binding.model,
        this._clock()
      ),
      binding,
    });
    const { draft: _consumedDraft, ...committedExperiment } = experiment;
    void _consumedDraft;
    const next: StudioExperimentRecord = {
      ...committedExperiment,
      agent: structuredClone(effectiveAgent),
      state: structuredClone(view.document.conversation.state),
      updatedAt: this._clock(),
    };
    const reference: StudioOperationReference = {
      sessionId: experiment.sessionId,
      lane: experiment.lane,
      operationId,
      ...(snapshot.leafId === null ? {} : { leafId: snapshot.leafId }),
      agentSnapshot: structuredClone(effectiveAgent),
      relation: "executed",
    };
    this._options.store.transaction((tx) => {
      tx.saveExperiment(next);
      tx.replaceOperationReferences(threadId, [
        ...tx.listOperationReferences(threadId),
        reference,
      ]);
    });
    this._emit(threadId, {
      type: "operation.started",
      operationId,
      sessionId: experiment.sessionId,
    });
    if (input.mode === "continue") {
      snapshot = await this._options.runtime.continue({
        sessionId: experiment.sessionId,
        lane: experiment.lane,
      });
    } else if (input.mode === "step" && snapshot.nextAction !== undefined) {
      snapshot = await this._options.runtime.step({
        sessionId: experiment.sessionId,
        lane: experiment.lane,
        expectedActionId: snapshot.nextAction.id,
        kind: snapshot.nextAction.kind,
      });
    }
    await this._recordSnapshot(threadId, snapshot);
    return { sessionId: experiment.sessionId, operationId };
  }

  /** Releases exactly one stable semantic action for an owned Pi operation. */
  async stepRun(
    operationId: string,
    input: StudioStepRunInput
  ): Promise<StudioRunReceipt> {
    this._requireOpen();
    const owner = this._requireOperation(operationId);
    const snapshot = await this._options.runtime.step({
      sessionId: owner.reference.sessionId,
      lane: owner.reference.lane,
      expectedActionId: input.expectedActionId,
      kind: input.kind,
    });
    await this._recordSnapshot(owner.threadId, snapshot);
    return { sessionId: owner.reference.sessionId, operationId };
  }

  /** Drives the same owned Pi operation to its next durable stop state. */
  async continueRun(operationId: string): Promise<StudioRunReceipt> {
    this._requireOpen();
    const owner = this._requireOperation(operationId);
    const snapshot = await this._options.runtime.continue({
      sessionId: owner.reference.sessionId,
      lane: owner.reference.lane,
    });
    await this._recordSnapshot(owner.threadId, snapshot);
    return { sessionId: owner.reference.sessionId, operationId };
  }

  /** Persists cancellation for the owning Pi Session and emits its projection. */
  async cancelRun(operationId: string): Promise<void> {
    this._requireOpen();
    const owner = this._requireOperation(operationId);
    const snapshot = await this._options.runtime.abort({
      sessionId: owner.reference.sessionId,
      lane: owner.reference.lane,
    });
    await this._recordSnapshot(owner.threadId, snapshot);
  }

  /** Replays Studio product events; execution detail itself travels over ACP. */
  async *events(
    threadId: string,
    cursor: StudioEventCursor = {}
  ): AsyncIterable<StudioThreadEvent> {
    this._requireOpen();
    this._requireExperiment(threadId);
    let sequence = cursor.afterSequence ?? 0;
    while (!cursor.signal?.aborted) {
      const events = this._options.store.transaction((tx) =>
        tx.listEvents(threadId, sequence)
      );
      for (const event of events) {
        sequence = event.sequence;
        yield event;
      }
      if (!cursor.follow) return;
      await this._waitForEvent(threadId, cursor.signal);
    }
  }

  /** Stops process-local effects before closing the Studio metadata store. */
  async close(): Promise<void> {
    if (this._closed) return;
    this._closed = true;
    for (const waiters of this._waiters.values()) {
      for (const wake of waiters) wake();
    }
    this._waiters.clear();
    try {
      await this._options.runtime.close();
    } finally {
      this._options.store.close();
    }
  }

  /** Composes Draft-first document state and active identity from Pi. */
  private async _composeThread(
    experiment: StudioExperimentRecord,
    known?: PiSessionSnapshot
  ): Promise<StudioThread> {
    const snapshot =
      known ??
      (await this._options.runtime.open({
        sessionId: experiment.sessionId,
        lane: experiment.lane,
      }));
    return {
      schemaVersion: 1,
      id: experiment.id,
      sessionId: experiment.sessionId,
      lane: experiment.lane,
      leafId: snapshot.leafId,
      ...(_hasActiveOperation(snapshot) && snapshot.operationId !== undefined
        ? { operationId: snapshot.operationId }
        : {}),
      runtimeFormatVersion: experiment.runtimeFormatVersion,
      document: {
        title: experiment.title,
        agent: structuredClone(experiment.agent),
        conversation: structuredClone(
          experiment.draft ?? {
            messages: piEntriesToCoreMessages(snapshot.messageEntries),
            state: experiment.state,
          }
        ),
      },
      ...(experiment.provenance === undefined
        ? {}
        : { provenance: structuredClone(experiment.provenance) }),
      createdAt: experiment.createdAt,
      updatedAt: experiment.updatedAt,
    };
  }

  /** Matches an edited base by reuse, Pi branch fork, or a replacement Session. */
  private async _prepareSession(
    experiment: StudioExperimentRecord,
    desiredBase: StudioConversation
  ): Promise<{
    readonly experiment: StudioExperimentRecord;
    readonly baseMessages: StudioConversation["messages"];
  }> {
    const snapshot = await this._options.runtime.open({
      sessionId: experiment.sessionId,
      lane: experiment.lane,
    });
    const committed = piEntriesToCoreMessages(snapshot.messageEntries);
    if (_sameMessages(committed, desiredBase.messages)) {
      return { experiment, baseMessages: [] };
    }
    if (committed.length === 0) {
      return { experiment, baseMessages: desiredBase.messages };
    }
    const prefixLength = _commonPrefixLength(committed, desiredBase.messages);
    const exactPrefix = prefixLength === desiredBase.messages.length;
    const forkEntry = exactPrefix
      ? snapshot.messageEntries[prefixLength - 1]
      : undefined;
    const replacement =
      exactPrefix && forkEntry !== undefined
        ? await this._options.runtime.forkSession({
            sessionId: experiment.sessionId,
            entryId: forkEntry.id,
          })
        : await this._options.runtime.createSession();
    const next: StudioExperimentRecord = {
      ...experiment,
      sessionId: replacement.sessionId,
      draft: desiredBase,
      updatedAt: this._clock(),
    };
    this._options.store.transaction((tx) => tx.saveExperiment(next));
    return {
      experiment: next,
      baseMessages: exactPrefix ? [] : desiredBase.messages,
    };
  }

  /** Updates the Studio reference leaf and emits committed conversation/outcome views. */
  private async _recordSnapshot(
    threadId: string,
    snapshot: PiSessionSnapshot
  ): Promise<void> {
    if (snapshot.operationId === undefined) return;
    this._options.store.transaction((tx) =>
      tx.replaceOperationReferences(
        threadId,
        tx.listOperationReferences(threadId).map((reference) =>
          reference.operationId === snapshot.operationId
            ? {
                ...reference,
                ...(snapshot.leafId === null
                  ? { leafId: undefined }
                  : { leafId: snapshot.leafId }),
              }
            : reference
        )
      )
    );
    const thread = await this.loadThread(threadId);
    if (thread !== undefined) {
      this._emit(threadId, {
        type: "conversation.updated",
        operationId: snapshot.operationId,
        thread,
      });
    }
    if (snapshot.status === "paused" || snapshot.status === "suspended") {
      this._emit(threadId, {
        type: "operation.paused",
        operationId: snapshot.operationId,
      });
    } else if (snapshot.status === "completed") {
      this._emit(threadId, {
        type: "operation.completed",
        operationId: snapshot.operationId,
      });
    } else if (snapshot.status === "aborted") {
      this._emit(threadId, {
        type: "operation.aborted",
        operationId: snapshot.operationId,
      });
    } else if (snapshot.status === "failed") {
      this._emit(threadId, {
        type: "operation.failed",
        operationId: snapshot.operationId,
        message: snapshot.suspension?.message ?? "Pi operation failed.",
      });
    }
  }

  /** Appends one product event and wakes all followers for that Experiment. */
  private _emit(threadId: string, event: StudioThreadEventData): void {
    this._options.store.transaction((tx) =>
      tx.appendEvent({ threadId, timestamp: this._clock(), event })
    );
    const waiters = this._waiters.get(threadId);
    if (waiters === undefined) return;
    this._waiters.delete(threadId);
    for (const wake of waiters) wake();
  }

  /** Waits without polling until an event, abort, or close wakes the follower. */
  private _waitForEvent(
    threadId: string,
    signal: AbortSignal | undefined
  ): Promise<void> {
    if (signal?.aborted || this._closed) return Promise.resolve();
    return new Promise((resolve) => {
      const waiters = this._waiters.get(threadId) ?? new Set();
      const wake = () => {
        signal?.removeEventListener("abort", wake);
        waiters.delete(wake);
        if (waiters.size === 0) this._waiters.delete(threadId);
        resolve();
      };
      waiters.add(wake);
      this._waiters.set(threadId, waiters);
      signal?.addEventListener("abort", wake, { once: true });
    });
  }

  /** Loads one Studio-owned Experiment record or fails with product identity. */
  private _requireExperiment(threadId: string): StudioExperimentRecord {
    const experiment = this._options.store.transaction((tx) =>
      tx.getExperiment(threadId)
    );
    if (experiment === undefined) {
      throw new Error(`Studio Thread "${threadId}" was not found.`);
    }
    return experiment;
  }

  /** Finds the Experiment and reference that own one Pi operation identity. */
  private _requireOperation(operationId: string): {
    readonly threadId: string;
    readonly reference: StudioOperationReference;
  } {
    for (const experiment of this._options.store.transaction((tx) =>
      tx.listExperiments()
    )) {
      const reference = this._options.store.transaction((tx) =>
        tx
          .listOperationReferences(experiment.id)
          .find((candidate) => candidate.operationId === operationId)
      );
      if (reference !== undefined) {
        return { threadId: experiment.id, reference };
      }
    }
    throw new Error(
      `Operation "${operationId}" does not belong to a Studio Thread.`
    );
  }

  /** Rejects API use after the Studio lifecycle has closed. */
  private _requireOpen(): void {
    if (this._closed) throw new Error("Studio application is closed.");
  }
}

/** Freezes current source, model, prompt, and tool identities for one Pi operation. */
function _runtimeBinding(agent: StudioAgentSnapshot): RuntimeBinding {
  const separator = agent.model.indexOf("/");
  if (separator <= 0 || separator === agent.model.length - 1) {
    throw new Error(
      `Pi model "${agent.model}" must use provider/model format.`
    );
  }
  return {
    formatVersion: STUDIO_PI_RUNTIME_FORMAT_VERSION,
    agent: {
      agentSpecId: agent.agentSpecId,
      sourceRevision: agent.sourceRevision,
    },
    model: {
      provider: agent.model.slice(0, separator),
      modelId: agent.model.slice(separator + 1),
    },
    systemPrompt: agent.instructions.join("\n\n"),
    tools: agent.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: structuredClone(tool.inputSchema),
      ...(tool.outputSchema === undefined
        ? {}
        : { outputSchema: structuredClone(tool.outputSchema) }),
      implementationId: tool.implementationId,
      replay: tool.replay,
      hostBinding: structuredClone(tool.hostBinding),
    })),
  };
}

/** Active identity exists only while Pi exposes a next action or suspension. */
function _hasActiveOperation(snapshot: PiSessionSnapshot): boolean {
  return snapshot.nextAction !== undefined || snapshot.status === "suspended";
}

/** Validates stable resource ids before replacing ordered metadata. */
function _assertUniqueIds(
  resources: readonly { readonly id: string }[],
  label: string
): void {
  const ids = new Set<string>();
  for (const resource of resources) {
    if (ids.has(resource.id)) {
      throw new Error(`${label} "${resource.id}" appears more than once.`);
    }
    ids.add(resource.id);
  }
}

/** Compares message content independently from object identity. */
function _sameMessages(
  left: StudioConversation["messages"],
  right: StudioConversation["messages"]
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** Finds the unchanged prefix used to select a Pi branch fork. */
function _commonPrefixLength(
  left: StudioConversation["messages"],
  right: StudioConversation["messages"]
): number {
  const length = Math.min(left.length, right.length);
  let index = 0;
  while (
    index < length &&
    JSON.stringify(left[index]) === JSON.stringify(right[index])
  ) {
    index += 1;
  }
  return index;
}
