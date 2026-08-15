import type {
  PiCommittedChange,
  PiOperationSnapshot,
  PiSessionSnapshot,
  RuntimeBinding,
  DurablePiRuntime,
} from "@llm-space/pi-runtime";

import { executeDebugCommand } from "./debug-command";
import {
  cancelActiveOperation,
  driveAdmittedOperation,
  hasActiveOperation,
  resolveOperationAdmission,
} from "./operation-lifecycle";
import {
  STUDIO_PI_LANE,
  STUDIO_PI_RUNTIME_FORMAT_VERSION,
  type StudioContinueInput,
  type StudioConversation,
  type StudioOperationReceipt,
  type StudioStepInput,
  type StudioToolApprovalInput,
} from "./pi-domain";
import {
  coreMessagesToPi,
  piEntriesToCoreMessages,
} from "./pi-message-projection";
import {
  agentSpecSnapshot,
  type AgentSpec,
  type Playground,
  type PlaygroundRecord,
} from "./playground";
import type { StudioStore } from "./storage";

export interface CreatePlaygroundApplicationOptions {
  readonly runtime: DurablePiRuntime;
  readonly store: StudioStore;
  readonly clock?: () => number;
  readonly generateId?: (prefix: string) => string;
}

export interface CreatePlaygroundInput {
  readonly title?: string;
  readonly agentSpec: AgentSpec;
  readonly conversation?: StudioConversation;
}

export interface SavePlaygroundInput {
  readonly title: string;
  readonly agentSpec: AgentSpec;
  readonly conversation: StudioConversation;
}

export type RunPlaygroundInput =
  | {
      readonly fromMessageId: string;
      readonly commandId: string;
      readonly signal?: AbortSignal;
      readonly mode?: undefined;
    }
  | {
      readonly fromMessageId: string;
      readonly mode: "step" | "continue";
      readonly commandId: string;
      readonly signal?: AbortSignal;
    };

export interface PlaygroundApplication {
  createPlayground(input: CreatePlaygroundInput): Promise<Playground>;
  loadPlayground(playgroundId: string): Promise<Playground | undefined>;
  listPlaygrounds(): Promise<readonly Playground[]>;
  savePlayground(
    playgroundId: string,
    input: SavePlaygroundInput
  ): Promise<Playground>;
  run(
    playgroundId: string,
    input: RunPlaygroundInput
  ): Promise<StudioOperationReceipt>;
  stepRun(
    playgroundId: string,
    operationId: string,
    input: StudioStepInput
  ): Promise<StudioOperationReceipt>;
  continueRun(
    playgroundId: string,
    operationId: string,
    input: StudioContinueInput
  ): Promise<StudioOperationReceipt>;
  resolveToolApproval(
    playgroundId: string,
    operationId: string,
    input: StudioToolApprovalInput
  ): Promise<StudioOperationReceipt>;
  cancelRun(playgroundId: string, operationId: string): Promise<void>;
  cancelActiveRun(playgroundId: string): Promise<void>;
  inspectRun(
    playgroundId: string,
    operationId: string
  ): Promise<PiSessionSnapshot>;
  getRun(operationId: string): Promise<PiOperationSnapshot | undefined>;
  listRuns(playgroundId: string): Promise<readonly PiOperationSnapshot[]>;
  streamRun(
    operationId: string,
    cursor?: { readonly afterSeq?: number; readonly signal?: AbortSignal }
  ): AsyncIterable<PiCommittedChange>;
  close(): Promise<void>;
}

export function createPlaygroundApplication(
  options: CreatePlaygroundApplicationOptions
): PlaygroundApplication {
  return new PlaygroundApplicationImpl(options);
}

class PlaygroundApplicationImpl implements PlaygroundApplication {
  private readonly _clock: () => number;
  private readonly _generateId: (prefix: string) => string;
  private _closed = false;

  constructor(private readonly _options: CreatePlaygroundApplicationOptions) {
    this._clock = _options.clock ?? Date.now;
    this._generateId =
      _options.generateId ??
      ((prefix) => `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`);
  }

  /** Creates one product Playground and one authoritative Pi Session. */
  async createPlayground(input: CreatePlaygroundInput): Promise<Playground> {
    this._requireOpen();
    const session = await this._options.runtime.createSession();
    const now = this._clock();
    const record: PlaygroundRecord = {
      schemaVersion: 1,
      id: this._generateId("playground"),
      title: input.title?.trim() || "New Playground",
      sessionId: session.sessionId,
      lane: STUDIO_PI_LANE,
      runtimeFormatVersion: STUDIO_PI_RUNTIME_FORMAT_VERSION,
      agentSpec: structuredClone(input.agentSpec),
      ...(input.conversation === undefined
        ? {}
        : { draft: structuredClone(input.conversation) }),
      state: structuredClone(input.conversation?.state ?? {}),
      operationReferences: [],
      createdAt: now,
      updatedAt: now,
    };
    this._options.store.transaction((tx) => tx.insertPlayground(record));
    return this._compose(record, session);
  }

  /** Rebuilds the editor view from Studio metadata and committed Pi entries. */
  async loadPlayground(playgroundId: string): Promise<Playground | undefined> {
    this._requireOpen();
    const record = this._options.store.transaction((tx) =>
      tx.getPlayground(playgroundId)
    );
    return record === undefined ? undefined : this._compose(record);
  }

  /** Lists product metadata while opening each Pi Session read-only. */
  async listPlaygrounds(): Promise<readonly Playground[]> {
    this._requireOpen();
    const records = this._options.store.transaction((tx) =>
      tx.listPlaygrounds()
    );
    return Promise.all(records.map((record) => this._compose(record)));
  }

  /** Saves an editable Draft without mutating the authoritative Pi transcript. */
  async savePlayground(
    playgroundId: string,
    input: SavePlaygroundInput
  ): Promise<Playground> {
    this._requireOpen();
    const record = this._requireRecord(playgroundId);
    const snapshot = await this._options.runtime.open({
      sessionId: record.sessionId,
      lane: record.lane,
    });
    const next: PlaygroundRecord = {
      ...record,
      title: input.title.trim() || record.title,
      agentSpec: structuredClone(input.agentSpec),
      draft: structuredClone(input.conversation),
      updatedAt: this._clock(),
    };
    this._options.store.transaction((tx) => tx.savePlayground(next));
    return this._compose(next, snapshot);
  }

  /** Admits one Pi operation from the selected user message and clears its Draft. */
  async run(
    playgroundId: string,
    input: RunPlaygroundInput
  ): Promise<StudioOperationReceipt> {
    this._requireOpen();
    let record = this._requireRecord(playgroundId);
    const admission = await resolveOperationAdmission({
      store: this._options.store,
      runtime: this._options.runtime,
      productId: playgroundId,
      productLabel: `Playground "${playgroundId}"`,
      sessionId: record.sessionId,
      lane: record.lane,
      commandId: input.commandId,
      commandInput: input,
      mode: input.mode,
    });
    if (admission.kind === "receipt") {
      return { sessionId: record.sessionId, operationId: admission.operationId };
    }
    const operationId = admission.operationId;
    const current = admission.snapshot;
    if (admission.kind === "recover") {
      record = this._reconcileAdmittedOperation(record, current);
      return this._driveAdmittedOperation(record, current, input);
    }
    const view = await this._compose(record, current);
    const inputIndex = view.conversation.messages.findIndex(
      (message) => message.id === input.fromMessageId
    );
    const inputMessage = view.conversation.messages[inputIndex];
    if (inputMessage?.role !== "user") {
      throw new Error(
        `Playground operation input "${input.fromMessageId}" must be a user Message.`
      );
    }

    const prepared = await this._prepareSession(record, {
      messages: view.conversation.messages.slice(0, inputIndex),
      state: structuredClone(view.conversation.state),
    });
    record = prepared.record;
    const binding = _runtimeBinding(record.id, record.agentSpec);
    const messages = coreMessagesToPi(
      [...prepared.baseMessages, inputMessage],
      binding.model,
      this._clock()
    );
    const snapshot = await this._options.runtime.start({
      operationId,
      sessionId: record.sessionId,
      lane: record.lane,
      messages,
      binding,
    });
    const { draft: _consumedDraft, ...committedRecord } = record;
    void _consumedDraft;
    const next: PlaygroundRecord = {
      ...committedRecord,
      state: structuredClone(view.conversation.state),
      operationReferences: [
        ...record.operationReferences,
        {
          sessionId: record.sessionId,
          lane: record.lane,
          operationId,
          ...(snapshot.leafId === null ? {} : { leafId: snapshot.leafId }),
          agentSnapshot: agentSpecSnapshot(record.id, record.agentSpec),
          relation: "executed",
        },
      ],
      updatedAt: this._clock(),
    };
    // Pi admission is authoritative. Studio clears the Draft immediately after
    // that commit so a host crash cannot leave a second pending-run model.
    this._options.store.transaction((tx) => tx.savePlayground(next));
    return this._driveAdmittedOperation(next, snapshot, input);
  }

  /** Applies the optional initial debugger mode after admission metadata commits. */
  private async _driveAdmittedOperation(
    record: PlaygroundRecord,
    initial: PiSessionSnapshot,
    input: RunPlaygroundInput
  ): Promise<StudioOperationReceipt> {
    const { operationId, snapshot } = await driveAdmittedOperation({
      store: this._options.store,
      runtime: this._options.runtime,
      productId: record.id,
      sessionId: record.sessionId,
      lane: record.lane,
      initial,
      commandId: input.commandId,
      commandInput: input,
      mode: input.mode,
      signal: input.signal,
      clock: this._clock,
    });
    this._recordSnapshot(operationId, snapshot);
    return { sessionId: record.sessionId, operationId };
  }

  /** Repairs a missing Playground reference from Pi's admitted identity. */
  private _reconcileAdmittedOperation(
    record: PlaygroundRecord,
    snapshot: PiSessionSnapshot
  ): PlaygroundRecord {
    if (snapshot.operationId === undefined) return record;
    const { draft, ...committed } = record;
    const reference = {
      sessionId: record.sessionId,
      lane: record.lane,
      operationId: snapshot.operationId,
      ...(snapshot.leafId === null ? {} : { leafId: snapshot.leafId }),
      agentSnapshot: agentSpecSnapshot(record.id, record.agentSpec),
      relation: "executed" as const,
    };
    const next: PlaygroundRecord = {
      ...committed,
      state: structuredClone(draft?.state ?? record.state),
      operationReferences: [
        ...record.operationReferences.filter(
          (item) => item.operationId !== snapshot.operationId
        ),
        reference,
      ],
      updatedAt: this._clock(),
    };
    this._options.store.transaction((tx) => tx.savePlayground(next));
    return next;
  }

  /** Releases exactly the stable Pi semantic action selected by the caller. */
  async stepRun(
    playgroundId: string,
    operationId: string,
    input: StudioStepInput
  ): Promise<StudioOperationReceipt> {
    this._requireOpen();
    const ownership = this._requireOperation(playgroundId, operationId);
    const snapshot = await executeDebugCommand({
      store: this._options.store,
      sessionId: ownership.sessionId,
      operationId,
      commandId: input.commandId,
      method: "step",
      input,
      clock: this._clock,
      readCurrent: () =>
        this._options.runtime.open({
          sessionId: ownership.sessionId,
          lane: ownership.lane,
        }),
      needsExecution: (current) =>
        current.nextAction?.id === input.expectedActionId,
      execute: () =>
        this._options.runtime.step({
          sessionId: ownership.sessionId,
          lane: ownership.lane,
          expectedActionId: input.expectedActionId,
          kind: input.kind,
        }),
    });
    this._recordSnapshot(operationId, snapshot);
    return { sessionId: ownership.sessionId, operationId };
  }

  /** Drives the same Pi operation until it reaches a durable stop state. */
  async continueRun(
    playgroundId: string,
    operationId: string,
    input: StudioContinueInput
  ): Promise<StudioOperationReceipt> {
    this._requireOpen();
    const ownership = this._requireOperation(playgroundId, operationId);
    const snapshot = await executeDebugCommand({
      store: this._options.store,
      sessionId: ownership.sessionId,
      operationId,
      commandId: input.commandId,
      method: "continue",
      input,
      clock: this._clock,
      readCurrent: () =>
        this._options.runtime.open({
          sessionId: ownership.sessionId,
          lane: ownership.lane,
        }),
      needsExecution: (current) => current.status === "paused",
      execute: () =>
        this._options.runtime.continue({
          sessionId: ownership.sessionId,
          lane: ownership.lane,
        }),
    });
    this._recordSnapshot(operationId, snapshot);
    return { sessionId: ownership.sessionId, operationId };
  }

  /** Commits a user decision for the operation's pending tool approval. */
  async resolveToolApproval(
    playgroundId: string,
    operationId: string,
    input: StudioToolApprovalInput
  ): Promise<StudioOperationReceipt> {
    this._requireOpen();
    const ownership = this._requireOperation(playgroundId, operationId);
    const snapshot = await this._options.runtime.resolveToolApproval({
      sessionId: ownership.sessionId,
      lane: ownership.lane,
      toolCallId: input.toolCallId,
      approved: input.approved,
    });
    this._recordSnapshot(operationId, snapshot);
    return { sessionId: ownership.sessionId, operationId };
  }

  /** Persists abort intent for the owning Pi Session operation. */
  async cancelRun(playgroundId: string, operationId: string): Promise<void> {
    this._requireOpen();
    const ownership = this._requireOperation(playgroundId, operationId);
    const snapshot = await this._options.runtime.abort({
      sessionId: ownership.sessionId,
      lane: ownership.lane,
    });
    this._recordSnapshot(operationId, snapshot);
  }

  /** Cancels the Pi-authoritative active operation without requiring a Studio reference. */
  async cancelActiveRun(playgroundId: string): Promise<void> {
    this._requireOpen();
    const record = this._requireRecord(playgroundId);
    const cancelled = await cancelActiveOperation({
      runtime: this._options.runtime,
      sessionId: record.sessionId,
      lane: record.lane,
    });
    if (cancelled === undefined) return;
    this._recordSnapshot(cancelled.operationId, cancelled.snapshot);
  }

  /** Reads the current durable debugger state for an owned operation. */
  async inspectRun(
    playgroundId: string,
    operationId: string
  ): Promise<PiSessionSnapshot> {
    this._requireOpen();
    const ownership = this._requireOperation(playgroundId, operationId);
    return this._options.runtime.open({
      sessionId: ownership.sessionId,
      lane: ownership.lane,
    });
  }

  /** Resolves one historical operation through Studio's Pi identity index. */
  async getRun(operationId: string): Promise<PiOperationSnapshot | undefined> {
    this._requireOpen();
    const ownership = this._findOperation(operationId);
    if (ownership === undefined) return undefined;
    return (
      await this._options.runtime.listOperations({
        sessionId: ownership.sessionId,
        lane: ownership.lane,
      })
    ).find((operation) => operation.operationId === operationId);
  }

  /** Projects ordered operation details from Pi while Studio owns only ordering. */
  async listRuns(
    playgroundId: string
  ): Promise<readonly PiOperationSnapshot[]> {
    this._requireOpen();
    const record = this._requireRecord(playgroundId);
    const bySession = new Map<string, readonly PiOperationSnapshot[]>();
    const result: PiOperationSnapshot[] = [];
    for (const reference of record.operationReferences) {
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
      if (operation !== undefined) result.push(operation);
    }
    return result;
  }

  /** Replays committed Pi log changes for the operation's owning Session. */
  async *streamRun(
    operationId: string,
    cursor: { readonly afterSeq?: number; readonly signal?: AbortSignal } = {}
  ): AsyncIterable<PiCommittedChange> {
    this._requireOpen();
    const ownership = this._findOperation(operationId);
    if (ownership === undefined) {
      throw new Error(
        `Operation "${operationId}" does not belong to a Playground.`
      );
    }
    yield* this._options.runtime.watch({
      sessionId: ownership.sessionId,
      lane: ownership.lane,
      ...cursor,
    });
  }

  /** Closes the product projection after stopping process-local runtime effects. */
  async close(): Promise<void> {
    if (this._closed) return;
    this._closed = true;
    try {
      await this._options.runtime.close();
    } finally {
      this._options.store.close();
    }
  }

  /** Composes a Draft-first view and derives active identity from Pi state. */
  private async _compose(
    record: PlaygroundRecord,
    known?: PiSessionSnapshot
  ): Promise<Playground> {
    const snapshot =
      known ??
      (await this._options.runtime.open({
        sessionId: record.sessionId,
        lane: record.lane,
      }));
    return {
      schemaVersion: 1,
      id: record.id,
      title: record.title,
      sessionId: record.sessionId,
      lane: record.lane,
      leafId: snapshot.leafId,
      ...(hasActiveOperation(snapshot) && snapshot.operationId !== undefined
        ? { operationId: snapshot.operationId }
        : {}),
      runtimeFormatVersion: record.runtimeFormatVersion,
      agentSpec: structuredClone(record.agentSpec),
      conversation: structuredClone(
        record.draft ?? {
          messages: piEntriesToCoreMessages(snapshot.messageEntries),
          state: structuredClone(record.state),
        }
      ),
      dirty: record.draft !== undefined,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  /** Reuses, branch-forks, or replaces the Pi Session to match an edited base. */
  private async _prepareSession(
    record: PlaygroundRecord,
    desiredBase: StudioConversation
  ): Promise<{
    readonly record: PlaygroundRecord;
    readonly baseMessages: StudioConversation["messages"];
  }> {
    const snapshot = await this._options.runtime.open({
      sessionId: record.sessionId,
      lane: record.lane,
    });
    const committed = piEntriesToCoreMessages(snapshot.messageEntries);
    if (_sameMessages(committed, desiredBase.messages)) {
      return { record, baseMessages: [] };
    }
    if (committed.length === 0) {
      return { record, baseMessages: desiredBase.messages };
    }

    const prefixLength = _commonPrefixLength(committed, desiredBase.messages);
    const exactCommittedPrefix = prefixLength === desiredBase.messages.length;
    const forkEntry = exactCommittedPrefix
      ? snapshot.messageEntries[prefixLength - 1]
      : undefined;
    const replacement =
      exactCommittedPrefix && forkEntry !== undefined
        ? await this._options.runtime.forkSession({
            sessionId: record.sessionId,
            entryId: forkEntry.id,
          })
        : await this._options.runtime.createSession();
    const next: PlaygroundRecord = {
      ...record,
      sessionId: replacement.sessionId,
      draft: desiredBase,
      updatedAt: this._clock(),
    };
    this._options.store.transaction((tx) => tx.savePlayground(next));
    return {
      record: next,
      baseMessages: exactCommittedPrefix ? [] : desiredBase.messages,
    };
  }

  /** Loads one Studio-owned Playground record or fails with product identity. */
  private _requireRecord(playgroundId: string): PlaygroundRecord {
    const record = this._options.store.transaction((tx) =>
      tx.getPlayground(playgroundId)
    );
    if (record === undefined) {
      throw new Error(`Playground "${playgroundId}" was not found.`);
    }
    return record;
  }

  /** Finds the Studio reference proving ownership of a Pi operation. */
  private _findOperation(operationId: string) {
    for (const playground of this._options.store.transaction((tx) =>
      tx.listPlaygrounds()
    )) {
      const reference = playground.operationReferences.find(
        (candidate) => candidate.operationId === operationId
      );
      if (reference !== undefined) return reference;
    }
    return undefined;
  }

  /** Requires Studio ownership before forwarding a mutating runtime command. */
  private _requireOperation(playgroundId: string, operationId: string) {
    const playground = this._requireRecord(playgroundId);
    const reference = playground.operationReferences.find(
      (candidate) => candidate.operationId === operationId
    );
    if (reference === undefined) {
      throw new Error(
        `Operation "${operationId}" does not belong to Playground "${playgroundId}".`
      );
    }
    return reference;
  }

  /** Keeps Studio's history pointer aligned with the latest committed Pi leaf. */
  private _recordSnapshot(
    operationId: string,
    snapshot: PiSessionSnapshot
  ): void {
    for (const record of this._options.store.transaction((tx) =>
      tx.listPlaygrounds()
    )) {
      if (
        !record.operationReferences.some(
          (reference) => reference.operationId === operationId
        )
      ) {
        continue;
      }
      this._options.store.transaction((tx) =>
        tx.savePlayground({
          ...record,
          operationReferences: record.operationReferences.map((reference) =>
            reference.operationId === operationId
              ? {
                  ...reference,
                  ...(snapshot.leafId === null
                    ? { leafId: undefined }
                    : { leafId: snapshot.leafId }),
                }
              : reference
          ),
          updatedAt: this._clock(),
        })
      );
      return;
    }
  }

  /** Prevents work after lifecycle shutdown. */
  private _requireOpen(): void {
    if (this._closed) throw new Error("Playground application is closed.");
  }
}

/** Freezes one Playground declaration into the runtime-owned identity schema. */
function _runtimeBinding(
  playgroundId: string,
  spec: AgentSpec
): RuntimeBinding {
  const snapshot = agentSpecSnapshot(playgroundId, spec);
  if (spec.model === undefined) {
    throw new Error(`Playground "${playgroundId}" does not have a model.`);
  }
  return {
    formatVersion: STUDIO_PI_RUNTIME_FORMAT_VERSION,
    agent: {
      agentSpecId: snapshot.agentSpecId,
      sourceRevision: snapshot.sourceRevision,
    },
    model: {
      provider: spec.model.provider,
      modelId: spec.model.id,
      ...(spec.model.params?.reasoning === undefined
        ? {}
        : { thinkingLevel: spec.model.params.reasoning }),
    },
    systemPrompt: snapshot.instructions.join("\n\n"),
    tools: snapshot.tools.map((tool) => ({
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

/** Compares editor messages without relying on reference identity. */
function _sameMessages(
  left: StudioConversation["messages"],
  right: StudioConversation["messages"]
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** Finds the unchanged committed prefix used to choose fork versus replacement. */
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
