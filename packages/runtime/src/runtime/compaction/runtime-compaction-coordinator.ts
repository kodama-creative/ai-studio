import {
  type AgentMessage,
  buildSessionContext,
  compact,
  type CompactionEntry,
  createCompactionSummaryMessage,
  DEFAULT_COMPACTION_SETTINGS,
  estimateContextTokens,
  estimateTokens,
  prepareCompaction,
  type SessionTreeEntry,
  shouldCompact,
  type ThinkingLevel
} from "@earendil-works/pi-agent-core";
import {
  type Api,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Context,
  createAssistantMessageEventStream,
  type Model,
  type Models,
  type SimpleStreamOptions
} from "@earendil-works/pi-ai";

import {
  latestRuntimeCompaction,
  type RuntimeCompactionSnapshot,
  runtimeHistoryMessagePath,
  type RuntimeHistorySnapshot
} from "../harness/runtime-history";
import { sha256 } from "../harness/sha256";
import {
  type DurableOperationCoordinator,
  fingerprintDurableOperationValue
} from "../operations/durable-operation-coordinator";

import type {
  RuntimeSessionMutation,
  SessionStore
} from "../harness/session-store";

export type RuntimeCompactionPhase = "compacting" | "idle";

export class RuntimeCompactionCoordinator {
  private readonly _models: Models;
  private readonly _sessionStore?: SessionStore;
  private readonly _sessionId: string;
  private readonly _runId: string;
  private readonly _durableOperations: DurableOperationCoordinator;
  private readonly _onPhase?: (phase: RuntimeCompactionPhase) => void;

  private _prepared = false;
  private _terminalError: Error | null = null;
  private _compaction: RuntimeCompactionSnapshot | null = null;
  private _firstKeptIndex = 0;
  private _initialPathLength = 0;

  constructor(options: {
    readonly durableOperations: DurableOperationCoordinator;
    readonly models: Models;
    readonly onPhase?: (phase: RuntimeCompactionPhase) => void;
    readonly runId: string;
    readonly sessionId: string;
    readonly sessionStore?: SessionStore;
  }) {
    this._durableOperations = options.durableOperations;
    this._models = options.models;
    this._onPhase = options.onPhase;
    this._runId = options.runId;
    this._sessionId = options.sessionId;
    this._sessionStore = options.sessionStore;
  }

  get terminalError(): Error | null {
    return this._terminalError;
  }

  async transform(
    messages: AgentMessage[],
    model: Model<Api>,
    thinkingLevel: ThinkingLevel,
    signal?: AbortSignal
  ): Promise<AgentMessage[]> {
    if (!this._sessionStore) { return messages; }
    try {
      if (!this._prepared) {
        this._prepared = true;
        await this._prepare(model, thinkingLevel, signal, false);
      }
      return this._project(messages);
    } catch (error) {
      this._terminalError = error instanceof Error
        ? error
        : new Error(String(error));
      return messages;
    }
  }

  async compactNow(
    messages: AgentMessage[],
    model: Model<Api>,
    thinkingLevel: ThinkingLevel,
    signal?: AbortSignal
  ): Promise<boolean> {
    if (!this._sessionStore) {
      throw new Error("Explicit context compaction requires a Session Store");
    }
    try {
      if (!this._prepared) {
        this._prepared = true;
        await this._prepare(model, thinkingLevel, signal, true);
      }
      this._project(messages);
      return this._compaction?.runId === this._runId;
    } catch (error) {
      this._terminalError = error instanceof Error
        ? error
        : new Error(String(error));
      throw this._terminalError;
    }
  }

  private async _prepare(
    model: Model<Api>,
    thinkingLevel: ThinkingLevel,
    signal: AbortSignal | undefined,
    force: boolean
  ): Promise<void> {
    const store = this._sessionStore;
    if (!store) { return; }
    let current = await store.load(this._sessionId);
    if (!current) {
      throw new Error(
        `Runtime Run ${this._runId} is not active for context compaction`
      );
    }
    const run = current?.snapshot.runs.find(item => item.id === this._runId);
    if (
      !force
      && current
      && !run
      && current.snapshot.activeRunId === null
    ) {
      return;
    }
    if (run?.id !== current.snapshot.activeRunId) {
      throw new Error(
        `Runtime Run ${this._runId} is not active for context compaction`
      );
    }
    if (!run) {
      throw new Error(
        `Runtime Run ${this._runId} is unavailable for context compaction`
      );
    }
    const sourceHeadEntryId = run.inputHeadEntryId;
    if (sourceHeadEntryId === null) { return; }
    const path = _piPath(
      current.snapshot.history,
      sourceHeadEntryId
    );
    this._initialPathLength = path.filter(entry => entry.type === "message")
      .length;
    this._compaction = latestRuntimeCompaction(
      current.snapshot.history,
      sourceHeadEntryId
    );
    if (
      force
      && this._compaction?.sourceHeadEntryId === sourceHeadEntryId
    ) {
      return;
    }
    if (this._compaction) {
      this._firstKeptIndex = runtimeHistoryMessagePath(
        current.snapshot.history,
        sourceHeadEntryId
      ).findIndex(entry => entry.id === this._compaction?.firstKeptEntryId);
      if (this._firstKeptIndex < 0) {
        throw new Error("Runtime compaction retained boundary is unavailable");
      }
    }
    if (current.snapshot.history.compactions.some(
      compaction => compaction.runId === run.id
    )) {
      return;
    }
    if (run.checkpoint) {
      return;
    }
    const projected = buildSessionContext(path).messages;
    const estimate = estimateContextTokens(projected);
    if (!force && !shouldCompact(
      estimate.tokens,
      model.contextWindow,
      DEFAULT_COMPACTION_SETTINGS
    )) {
      return;
    }
    const prepared = prepareCompaction(path, DEFAULT_COMPACTION_SETTINGS);
    if (!prepared.ok) { throw prepared.error; }
    if (!prepared.value) { return; }

    this._onPhase?.("compacting");
    let summaryTail: Promise<void> = Promise.resolve();
    let auxiliarySlot = 0;
    let auxiliaryFailure: Error | null = null;
    const durableModels = new Proxy(this._models, {
      get: (target, property) => {
        if (property !== "completeSimple") {
          const value: unknown = Reflect.get(target, property, target);
          return typeof value === "function"
            ? (...args: unknown[]): unknown =>
              Reflect.apply(value, target, args) as unknown
            : value;
        }
        return async (
          summaryModel: Model<Api>,
          context: Context,
          options?: SimpleStreamOptions
        ): Promise<AssistantMessage> => {
          const slot = `compaction-${++auxiliarySlot}`;
          let resolveMessage!: (message: AssistantMessage) => void;
          let rejectMessage!: (error: unknown) => void;
          const result = new Promise<AssistantMessage>((resolve, reject) => {
            resolveMessage = resolve;
            rejectMessage = reject;
          });
          summaryTail = summaryTail.then(async () => {
            if (auxiliaryFailure) {
              rejectMessage(auxiliaryFailure);
              return;
            }
            try {
              const {
                signal: operationSignal,
                ...durableOptions
              } = options ?? {};
              const message = await this._durableOperations
                .completeAuxiliaryProvider({
                  provider: summaryModel.provider,
                  slot,
                  signal: operationSignal ?? signal,
                  transcriptMessageCount: this._initialPathLength,
                  request: {
                    model: {
                      api: summaryModel.api,
                      provider: summaryModel.provider,
                      id: summaryModel.id,
                      baseUrl: summaryModel.baseUrl
                    },
                    context: _durableCompactionContext(context),
                    options: durableOptions
                  },
                  execute: async () => target.completeSimple(
                    summaryModel,
                    context,
                    options
                  )
                });
              resolveMessage(message);
            } catch (error) {
              auxiliaryFailure = error instanceof Error
                ? error
                : new Error(String(error));
              rejectMessage(auxiliaryFailure);
            }
          });
          return result;
        };
      }
    });

    try {
      const result = await compact(
        prepared.value,
        durableModels,
        model,
        undefined,
        signal,
        thinkingLevel
      );
      await summaryTail;
      if (!result.ok) {
        await this._durableOperations.checkpointProviderOnlyStep();
        throw result.error;
      }
      if (
        result.value.summary.trim().length === 0
        || result.value.firstKeptEntryId !== prepared.value.firstKeptEntryId
      ) {
        await this._durableOperations.checkpointProviderOnlyStep();
        throw new Error("Runtime compaction returned invalid summary metadata");
      }
      const summaryFingerprint = await sha256(result.value.summary);
      const requestFingerprint = await fingerprintDurableOperationValue({
        sourceHeadEntryId: run.inputHeadEntryId,
        firstKeptEntryId: result.value.firstKeptEntryId,
        model: { provider: model.provider, id: model.id },
        settings: DEFAULT_COMPACTION_SETTINGS
      });
      const provisional: RuntimeCompactionSnapshot = {
        id: `${run.id}:compaction:1`,
        runId: run.id,
        branchId: run.branchId,
        sourceCheckpointId: run.baseCheckpointId,
        sourceHeadEntryId,
        firstKeptEntryId: result.value.firstKeptEntryId,
        summary: result.value.summary,
        summaryFingerprint,
        requestFingerprint,
        model: { provider: model.provider, id: model.id },
        contextWindow: model.contextWindow,
        tokenEvidence: {
          tokensBefore: estimate.tokens,
          tokensAfter: 0,
          usageTokens: estimate.usageTokens,
          trailingTokens: estimate.trailingTokens,
          lastUsageMessageIndex: estimate.lastUsageIndex
        },
        createdAt: Date.now()
      };
      const projectedAfter = buildSessionContext(_piPath(
        current.snapshot.history,
        sourceHeadEntryId,
        provisional
      )).messages;
      const tokensAfter = projectedAfter.reduce(
        (total, message) => total + estimateTokens(message),
        0
      );
      const mutation: RuntimeSessionMutation = {
        type: "recordCompaction",
        runId: run.id,
        firstKeptEntryId: result.value.firstKeptEntryId,
        summary: result.value.summary,
        summaryFingerprint,
        requestFingerprint,
        contextWindow: model.contextWindow,
        tokensBefore: estimate.tokens,
        tokensAfter,
        usageTokens: estimate.usageTokens,
        trailingTokens: estimate.trailingTokens,
        lastUsageMessageIndex: estimate.lastUsageIndex
      };
      current = await this._durableOperations.commitProviderOnlyStepWith([
        mutation
      ]);
      this._compaction = current.snapshot.history.compactions.find(
        compaction => compaction.runId === run.id
      ) ?? null;
      if (!this._compaction) {
        throw new Error("Runtime compaction disappeared after commit");
      }
      this._firstKeptIndex = runtimeHistoryMessagePath(
        current.snapshot.history,
        run.inputHeadEntryId
      ).findIndex(entry => entry.id === this._compaction?.firstKeptEntryId);
      if (this._firstKeptIndex < 0) {
        throw new Error("Runtime compaction retained boundary disappeared");
      }
    } catch (error) {
      await summaryTail.catch(() => {});
      throw error;
    } finally {
      this._onPhase?.("idle");
    }
  }

  private _project(messages: AgentMessage[]): AgentMessage[] {
    const compaction = this._compaction;
    if (!compaction) { return messages; }
    return [
      createCompactionSummaryMessage(
        compaction.summary,
        compaction.tokenEvidence.tokensBefore,
        new Date(compaction.createdAt).toISOString()
      ),
      ...messages.slice(this._firstKeptIndex)
    ];
  }
}

function _durableCompactionContext(context: Context): Context {
  return {
    ...context,
    messages: context.messages.map(message => ({
      ...message,
      // Pi creates the synthetic summarization user message at dispatch time.
      // Its timestamp is not provider-semantic and must not prevent replay of
      // an otherwise byte-identical durable completion after restart.
      timestamp: 0
    }))
  };
}

export function runtimeCompactionErrorStream(
  model: Model<Api>,
  error: Error
): AssistantMessageEventStream {
  const message: AssistantMessage = {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0
      }
    },
    stopReason: "error",
    errorMessage: error.message,
    timestamp: Date.now()
  };
  const stream = createAssistantMessageEventStream();
  queueMicrotask(() => {
    stream.push({ type: "error", reason: "error", error: message });
  });
  return stream;
}

function _piPath(
  history: RuntimeHistorySnapshot,
  headEntryId: string | null,
  forcedCompaction?: RuntimeCompactionSnapshot
): SessionTreeEntry[] {
  const messages: SessionTreeEntry[] = runtimeHistoryMessagePath(
    history,
    headEntryId
  ).map(entry => ({
    type: "message" as const,
    id: entry.id,
    parentId: entry.parentId,
    timestamp: new Date(entry.createdAt).toISOString(),
    message: entry.message as unknown as AgentMessage
  }));
  const compaction = forcedCompaction
    ?? latestRuntimeCompaction(history, headEntryId);
  if (!compaction) { return messages; }
  const sourceIndex = messages.findIndex(
    entry => entry.id === compaction.sourceHeadEntryId
  );
  if (sourceIndex < 0) { return messages; }
  const entry: CompactionEntry = {
    type: "compaction",
    id: compaction.id,
    parentId: compaction.sourceHeadEntryId,
    timestamp: new Date(compaction.createdAt).toISOString(),
    summary: compaction.summary,
    firstKeptEntryId: compaction.firstKeptEntryId,
    tokensBefore: compaction.tokenEvidence.tokensBefore
  };
  return [
    ...messages.slice(0, sourceIndex + 1),
    entry,
    ...messages.slice(sourceIndex + 1)
  ];
}
