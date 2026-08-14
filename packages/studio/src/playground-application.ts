import type {
  PiCommittedChange,
  PiOperationSnapshot,
  PiSessionSnapshot,
  RuntimeBinding,
  StudioPiSessionRuntime,
} from "@llm-space/pi-runtime";

import {
  STUDIO_PI_LANE,
  STUDIO_PI_RUNTIME_FORMAT_VERSION,
  type StudioConversation,
  type StudioOperationReceipt,
  type StudioStepInput,
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
  readonly runtime: StudioPiSessionRuntime;
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

export interface RunPlaygroundInput {
  readonly fromMessageId: string;
  readonly mode?: "step" | "continue";
}

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
    operationId: string,
    input: StudioStepInput
  ): Promise<StudioOperationReceipt>;
  continueRun(operationId: string): Promise<StudioOperationReceipt>;
  cancelRun(operationId: string): Promise<void>;
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
    if (_hasActiveOperation(snapshot)) {
      throw new Error(`Playground "${playgroundId}" has an active operation.`);
    }
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
    const view = await this._compose(record);
    if (view.operationId !== undefined) {
      throw new Error(`Playground "${playgroundId}" has an active operation.`);
    }
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
    const operationId = this._generateId("operation");
    const binding = _runtimeBinding(record.id, record.agentSpec);
    const messages = coreMessagesToPi(
      [...prepared.baseMessages, inputMessage],
      binding.model,
      this._clock()
    );
    let snapshot = await this._options.runtime.start({
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
    if (input.mode === "continue") {
      snapshot = await this._options.runtime.continue({
        sessionId: record.sessionId,
        lane: record.lane,
      });
    } else if (input.mode === "step" && snapshot.nextAction !== undefined) {
      snapshot = await this._options.runtime.step({
        sessionId: record.sessionId,
        lane: record.lane,
        expectedActionId: snapshot.nextAction.id,
        kind: snapshot.nextAction.kind,
      });
    }
    this._recordSnapshot(operationId, snapshot);
    return { sessionId: record.sessionId, operationId };
  }

  /** Releases exactly the stable Pi semantic action selected by the caller. */
  async stepRun(
    operationId: string,
    input: StudioStepInput
  ): Promise<StudioOperationReceipt> {
    this._requireOpen();
    const ownership = this._requireOperation(operationId);
    const snapshot = await this._options.runtime.step({
      sessionId: ownership.sessionId,
      lane: ownership.lane,
      expectedActionId: input.expectedActionId,
      kind: input.kind,
    });
    this._recordSnapshot(operationId, snapshot);
    return { sessionId: ownership.sessionId, operationId };
  }

  /** Drives the same Pi operation until it reaches a durable stop state. */
  async continueRun(operationId: string): Promise<StudioOperationReceipt> {
    this._requireOpen();
    const ownership = this._requireOperation(operationId);
    const snapshot = await this._options.runtime.continue({
      sessionId: ownership.sessionId,
      lane: ownership.lane,
    });
    this._recordSnapshot(operationId, snapshot);
    return { sessionId: ownership.sessionId, operationId };
  }

  /** Persists abort intent for the owning Pi Session operation. */
  async cancelRun(operationId: string): Promise<void> {
    this._requireOpen();
    const ownership = this._requireOperation(operationId);
    const snapshot = await this._options.runtime.abort({
      sessionId: ownership.sessionId,
      lane: ownership.lane,
    });
    this._recordSnapshot(operationId, snapshot);
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
    const ownership = this._requireOperation(operationId);
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
      ...(_hasActiveOperation(snapshot) && snapshot.operationId !== undefined
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
  private _requireOperation(operationId: string) {
    const reference = this._findOperation(operationId);
    if (reference === undefined) {
      throw new Error(
        `Operation "${operationId}" does not belong to a Playground.`
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

/** An operation remains active only while Pi exposes a next action or suspension. */
function _hasActiveOperation(snapshot: PiSessionSnapshot): boolean {
  return snapshot.nextAction !== undefined || snapshot.status === "suspended";
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
