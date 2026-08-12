import type {
  AgentEngine,
  Run,
  RunEventCursor,
  RunFrame,
  RunExecutionMode,
  ThreadState,
} from "@llm-space/engine";

import type { StudioRunReceipt } from "./domain";
import {
  agentSpecSnapshot,
  type AgentSpec,
  type Playground,
  type PlaygroundRecord,
} from "./playground";
import type { StudioStore } from "./storage";

export interface CreatePlaygroundApplicationOptions {
  readonly engine: AgentEngine;
  readonly store: StudioStore;
  readonly clock?: () => number;
  readonly generateId?: (prefix: string) => string;
}

export interface CreatePlaygroundInput {
  readonly title?: string;
  readonly agentSpec: AgentSpec;
  readonly conversation?: ThreadState;
}

export interface SavePlaygroundInput {
  readonly title: string;
  readonly agentSpec: AgentSpec;
  readonly conversation: ThreadState;
}

export interface RunPlaygroundInput {
  readonly fromMessageId: string;
  readonly mode?: RunExecutionMode;
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
  ): Promise<StudioRunReceipt>;
  stepRun(
    runId: string,
    input?: { readonly toolCallId?: string }
  ): Promise<StudioRunReceipt>;
  continueRun(runId: string): Promise<StudioRunReceipt>;
  cancelRun(runId: string): Promise<void>;
  getRun(runId: string): Promise<Run | undefined>;
  listRuns(playgroundId: string): Promise<readonly Run[]>;
  streamRun(runId: string, cursor?: RunEventCursor): AsyncIterable<RunFrame>;
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

  constructor(private readonly _options: CreatePlaygroundApplicationOptions) {
    this._clock = _options.clock ?? Date.now;
    this._generateId =
      _options.generateId ??
      ((prefix) => `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`);
  }

  /** Create the stable Playground identity and its initial Engine Thread. */
  async createPlayground(input: CreatePlaygroundInput): Promise<Playground> {
    const thread = await this._options.engine.createThread({
      ...(input.conversation === undefined
        ? {}
        : { initialState: input.conversation }),
    });
    const now = this._clock();
    const record: PlaygroundRecord = {
      schemaVersion: 1,
      id: this._generateId("playground"),
      title: input.title?.trim() || "New Playground",
      engineThreadId: thread.id,
      agentSpec: structuredClone(input.agentSpec),
      createdAt: now,
      updatedAt: now,
    };
    this._options.store.transaction((tx) => tx.insertPlayground(record));
    return this._compose(record);
  }

  async loadPlayground(
    playgroundId: string
  ): Promise<Playground | undefined> {
    const record = this._options.store.transaction((tx) =>
      tx.getPlayground(playgroundId)
    );
    return record === undefined ? undefined : this._compose(record);
  }

  async listPlaygrounds(): Promise<readonly Playground[]> {
    const records = this._options.store.transaction((tx) =>
      tx.listPlaygrounds()
    );
    return Promise.all(records.map((record) => this._compose(record)));
  }

  /** Save editable declaration and model state as a dirty Studio Draft. */
  async savePlayground(
    playgroundId: string,
    input: SavePlaygroundInput
  ): Promise<Playground> {
    const record = this._requireRecord(playgroundId);
    const active = await this._activeRun(record.engineThreadId);
    if (active !== undefined) {
      throw new Error(`Playground "${playgroundId}" has an active Run.`);
    }
    const next: PlaygroundRecord = {
      ...record,
      title: input.title.trim() || record.title,
      agentSpec: structuredClone(input.agentSpec),
      draft: structuredClone(input.conversation),
      updatedAt: this._clock(),
    };
    this._options.store.transaction((tx) => tx.savePlayground(next));
    return this._compose(next);
  }

  /** Consume the Draft into the Engine and start one user-triggered Run. */
  async run(
    playgroundId: string,
    input: RunPlaygroundInput
  ): Promise<StudioRunReceipt> {
    let record = this._requireRecord(playgroundId);
    if ((await this._activeRun(record.engineThreadId)) !== undefined) {
      throw new Error(`Playground "${playgroundId}" has an active Run.`);
    }
    const view = await this._compose(record);
    const messages = view.conversation.messages;
    const inputIndex = messages.findIndex(
      (message) => message.id === input.fromMessageId
    );
    const inputMessage = messages[inputIndex];
    if (inputMessage?.role !== "user") {
      throw new Error(
        `Playground Run input "${input.fromMessageId}" must be a user Message.`
      );
    }
    const desiredBase: ThreadState = {
      messages: messages.slice(0, inputIndex),
      state: structuredClone(view.conversation.state),
    };
    const thread = await this._prepareThread(record, desiredBase);
    const run = await this._options.engine.startRun({
      threadId: thread.id,
      expectedHeadCheckpointId: thread.headCheckpointId,
      inputMessages: [inputMessage],
      agentSnapshot: agentSpecSnapshot(record.id, record.agentSpec),
      ...(input.mode === undefined ? {} : { mode: input.mode }),
    });
    record = {
      ...record,
      engineThreadId: thread.id,
      draft: undefined,
      updatedAt: this._clock(),
    };
    this._options.store.transaction((tx) => tx.savePlayground(record));
    return { runId: run.id };
  }

  async stepRun(
    runId: string,
    input: { readonly toolCallId?: string } = {}
  ): Promise<StudioRunReceipt> {
    await this._requireRunOwnership(runId);
    const run = await this._options.engine.stepRun({ runId, ...input });
    return { runId: run.id };
  }

  async continueRun(runId: string): Promise<StudioRunReceipt> {
    await this._requireRunOwnership(runId);
    const run = await this._options.engine.continueRun(runId);
    return { runId: run.id };
  }

  async cancelRun(runId: string): Promise<void> {
    await this._requireRunOwnership(runId);
    await this._options.engine.cancelRun(runId);
  }

  getRun(runId: string): Promise<Run | undefined> {
    return this._options.engine.getRun(runId);
  }

  async listRuns(playgroundId: string): Promise<readonly Run[]> {
    const record = this._requireRecord(playgroundId);
    return this._options.engine.listRuns(record.engineThreadId);
  }

  async *streamRun(
    runId: string,
    cursor: RunEventCursor = {}
  ): AsyncIterable<RunFrame> {
    await this._requireRunOwnership(runId);
    yield* this._options.engine.streamRun(runId, cursor);
  }

  async close(): Promise<void> {
    try {
      await this._options.engine.close();
    } finally {
      this._options.store.close();
    }
  }

  private async _compose(record: PlaygroundRecord): Promise<Playground> {
    const thread = await this._options.engine.getThread(record.engineThreadId);
    if (thread === undefined) {
      throw new Error(`Engine Thread "${record.engineThreadId}" was not found.`);
    }
    const checkpoint = await this._options.engine.getCheckpoint(
      thread.headCheckpointId
    );
    if (checkpoint === undefined) {
      throw new Error(`Checkpoint "${thread.headCheckpointId}" was not found.`);
    }
    const activeRun = await this._activeRun(record.engineThreadId);
    return {
      schemaVersion: 1,
      id: record.id,
      title: record.title,
      engineThreadId: record.engineThreadId,
      headCheckpointId: thread.headCheckpointId,
      agentSpec: structuredClone(record.agentSpec),
      conversation: structuredClone(record.draft ?? checkpoint.threadState),
      dirty: record.draft !== undefined,
      ...(activeRun === undefined ? {} : { activeRunId: activeRun.id }),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  private async _prepareThread(
    record: PlaygroundRecord,
    desiredBase: ThreadState
  ) {
    const current = await this._options.engine.getThread(record.engineThreadId);
    if (current === undefined) {
      throw new Error(`Engine Thread "${record.engineThreadId}" was not found.`);
    }
    const head = await this._options.engine.getCheckpoint(
      current.headCheckpointId
    );
    if (head === undefined) {
      throw new Error(`Checkpoint "${current.headCheckpointId}" was not found.`);
    }
    if (_sameState(head.threadState, desiredBase)) return current;
    const matching = (await this._options.engine.listCheckpoints(current.id))
      .findLast((checkpoint) => _sameState(checkpoint.threadState, desiredBase));
    const fork = await this._options.engine.forkThread({
      threadId: current.id,
      ...(matching === undefined ? {} : { checkpointId: matching.id }),
    });
    if (matching !== undefined) return fork;
    const checkpoint = await this._options.engine.commitThreadState({
      threadId: fork.id,
      expectedHeadCheckpointId: fork.headCheckpointId,
      threadState: desiredBase,
    });
    return { ...fork, headCheckpointId: checkpoint.id };
  }

  private async _activeRun(engineThreadId: string): Promise<Run | undefined> {
    return (await this._options.engine.listRuns(engineThreadId)).find(
      (run) =>
        run.status === "queued" ||
        run.status === "running" ||
        run.status === "paused"
    );
  }

  private _requireRecord(playgroundId: string): PlaygroundRecord {
    const record = this._options.store.transaction((tx) =>
      tx.getPlayground(playgroundId)
    );
    if (record === undefined) {
      throw new Error(`Playground "${playgroundId}" was not found.`);
    }
    return record;
  }

  private async _requireRunOwnership(runId: string): Promise<void> {
    const run = await this._options.engine.getRun(runId);
    const owns =
      run !== undefined &&
      this._options.store.transaction((tx) =>
        tx
          .listPlaygrounds()
          .some((record) => record.engineThreadId === run.threadId)
      );
    if (!owns) {
      throw new Error(`Run "${runId}" does not belong to a Playground.`);
    }
  }
}

function _sameState(left: ThreadState, right: ThreadState): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
