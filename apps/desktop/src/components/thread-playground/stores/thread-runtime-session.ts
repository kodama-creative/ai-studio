import { getThreadRuntimeProfile, uuid } from "@llm-space/core";
import {
  claimRuntimeRunResume,
  InMemorySessionStore,
  recoverRuntimeSession,
  type RuntimeRunConfigurationSnapshot,
  type RuntimeRunState,
  type RuntimeStructuredOutputResult,
  SessionStoreInvariantError,
  type StoredRuntimeSession
} from "@llm-space/runtime/harness";

import type {
  ModelConfig,
  Thread,
  ThreadContext,
  ThreadRuntimeCheckpoint,
  ThreadRuntimeRunState,
  ThreadStructuredOutput
} from "@llm-space/core";
import type { RuntimeExecutionMode } from "@llm-space/runtime";

export interface ThreadRuntimeExecutionInput {
  readonly context: ThreadContext;
  readonly executionMode: RuntimeExecutionMode;
  readonly model: ModelConfig;
  readonly thread: Thread;
  readonly outputContractSnapshot?: {
    readonly name: string;
    readonly schemaFingerprint: string;
  };
  readonly structuredOutput?: ThreadStructuredOutput;
}

export interface BegunThreadRuntimeRun {
  readonly runId: string;
  readonly session: StoredRuntimeSession;
}

export interface SettledThreadRuntimeRun {
  readonly checkpoint: ThreadRuntimeCheckpoint | null;
  readonly session: StoredRuntimeSession;
}

export class ThreadRuntimeOutcomeUnknownError extends Error {
  readonly runId: string;
  readonly session: StoredRuntimeSession;

  constructor(runId: string, session: StoredRuntimeSession) {
    super(
      `Runtime Run ${runId} was interrupted during model or tool work; its outcome is unknown and automatic replay is disabled`
    );
    this.name = "ThreadRuntimeOutcomeUnknownError";
    this.runId = runId;
    this.session = session;
  }
}

/**
 * Coordinates one Desktop Thread with the Host-neutral Runtime Harness store.
 * The caller persists each returned record inside the owning Thread document.
 */
export class ThreadRuntimeSession {
  private readonly _store: InMemorySessionStore;
  private readonly _sessionId: string;
  private readonly _loadError: Error | null;

  constructor(persisted: unknown) {
    if (persisted === undefined) {
      this._sessionId = `session-${uuid()}`;
      this._store = new InMemorySessionStore();
      this._loadError = null;
      return;
    }

    try {
      const session = _asStoredRuntimeSession(persisted);
      this._sessionId = session.snapshot.id;
      this._store = new InMemorySessionStore([session]);
      this._loadError = null;
    } catch (error) {
      this._sessionId = "invalid-runtime-session";
      this._store = new InMemorySessionStore();
      this._loadError = error instanceof Error
        ? error
        : new SessionStoreInvariantError("Invalid Runtime Session metadata");
    }
  }

  get loadError(): Error | null {
    return this._loadError;
  }

  async begin(input: ThreadRuntimeExecutionInput): Promise<BegunThreadRuntimeRun> {
    this._assertLoaded();
    const recovery = await recoverRuntimeSession(this._store, this._sessionId);
    if (recovery.status === "outcomeUnknown") {
      throw new ThreadRuntimeOutcomeUnknownError(
        recovery.run.id,
        recovery.session
      );
    }
    const current = recovery.status === "missing" ? null : recovery.session;
    const continuationFingerprint = await threadContinuationFingerprint(input);
    const configuration = await _configuration(input);
    const activeRunId = current?.snapshot.activeRunId ?? null;

    if (current && activeRunId) {
      const active = current.snapshot.runs.find(run => run.id === activeRunId);
      if (!active) {
        throw new SessionStoreInvariantError(
          `Runtime Session ${this._sessionId} has no active Run ${activeRunId}`
        );
      }
      if (
        active.state !== "waitingForToolResults"
        && active.state !== "waitingForContinue"
      ) {
        throw new SessionStoreInvariantError(
          `Runtime Run ${active.id} cannot resume from ${active.state}`
        );
      }
      if (
        active.checkpoint?.continuationFingerprint === continuationFingerprint
      ) {
        if (
          active.state === "waitingForToolResults"
          && !_hasCompleteTrailingToolResults(input.thread)
        ) {
          throw new SessionStoreInvariantError(
            "Complete every pending tool result before continuing this Runtime Run"
          );
        }
        return {
          runId: active.id,
          session: await claimRuntimeRunResume(this._store, {
            sessionId: this._sessionId,
            expectedVersion: current.version,
            runId: active.id
          })
        };
      }

      const runId = `run-${uuid()}`;
      return {
        runId,
        session: await this._store.commit({
          sessionId: this._sessionId,
          expectedVersion: current.version,
          mutations: [
            { type: "transitionRun", runId: active.id, to: "superseded" },
            { type: "startRun", runId, configuration }
          ]
        })
      };
    }

    const runId = `run-${uuid()}`;
    return {
      runId,
      session: await this._store.commit({
        sessionId: this._sessionId,
        expectedVersion: current?.version ?? null,
        mutations: [{ type: "startRun", runId, configuration }]
      })
    };
  }

  async settle(
    input: {
      readonly outcome:
        | "cancelled"
        | "completed"
        | "failed"
        | "outcomeUnknown";
      readonly runId: string;
      readonly sawEvent: boolean;
    } & ThreadRuntimeExecutionInput
  ): Promise<SettledThreadRuntimeRun> {
    this._assertLoaded();
    const current = await this._store.load(this._sessionId);
    if (current?.snapshot.activeRunId !== input.runId) {
      throw new SessionStoreInvariantError(
        `Runtime Run ${input.runId} is not active in Session ${this._sessionId}`
      );
    }
    const mutations = _settleMutations(input);
    if (input.sawEvent) {
      mutations.push({
        type: "recordCheckpoint",
        runId: input.runId,
        continuationFingerprint: await threadContinuationFingerprint(input)
      });
    }
    const session = await this._store.commit({
      sessionId: this._sessionId,
      expectedVersion: current.version,
      mutations
    });
    if (!input.sawEvent) {
      return { checkpoint: null, session };
    }
    const run = session.snapshot.runs.find(run => run.id === input.runId);
    if (!run?.checkpoint) {
      throw new SessionStoreInvariantError(
        `Runtime Run ${input.runId} did not record its settled checkpoint`
      );
    }
    return {
      session,
      checkpoint: {
        runId: input.runId,
        state: run.checkpoint.state,
        checkpointOrder: run.checkpoint.order,
        continuationFingerprint: run.checkpoint.continuationFingerprint,
        profile: getThreadRuntimeProfile(input.thread).type,
        ...(input.outputContractSnapshot
          ? { outputContract: input.outputContractSnapshot }
          : {})
      }
    };
  }

  private _assertLoaded(): void {
    if (this._loadError) {
      throw new SessionStoreInvariantError(
        `Runtime Session metadata is invalid: ${this._loadError.message}`
      );
    }
  }
}

/** Read current Runtime Run states for Run History presentation. */
export function runtimeRunStates(
  persisted: unknown
): ReadonlyMap<string, ThreadRuntimeRunState> {
  try {
    const session = _asStoredRuntimeSession(persisted);
    // Reuse the Runtime Harness invariant validator before presenting metadata.
    const validatedStore = new InMemorySessionStore([session]);
    void validatedStore;
    return new Map(
      session.snapshot.runs.map(run => [run.id, run.state] as const)
    );
  } catch {
    return new Map();
  }
}

export async function threadContinuationFingerprint(
  input: ThreadRuntimeExecutionInput
): Promise<string> {
  const messages = [...(input.context.messages ?? [])];
  const trailing = messages.at(-1);
  if (trailing?.role === "assistant" && trailing.toolCalls?.length) {
    messages[messages.length - 1] = {
      ...trailing,
      toolCalls: trailing.toolCalls.map(({ output: _output, ...toolCall }) => ({
        ...toolCall,
        output: { content: [{ type: "text", text: "<runtime-tool-output>" }] }
      }))
    };
  }
  return _fingerprint({
    agentSnapshot: input.thread.agentRuntime?.snapshot ?? "standalone-thread",
    context: {
      ...input.context,
      messages,
      snapshot: undefined,
      tools: undefined
    },
    executionMode: input.executionMode,
    model: input.model,
    outputContract: input.outputContractSnapshot ?? null,
    runtimeProfile: getThreadRuntimeProfile(input.thread).type,
    tools: input.context.tools ?? []
  });
}

async function _configuration(
  input: ThreadRuntimeExecutionInput
): Promise<RuntimeRunConfigurationSnapshot> {
  const agentSnapshotFingerprint =
    input.thread.agentRuntime?.snapshot ?? "standalone-thread";
  const contextFingerprint = await _fingerprint({
    ...input.context,
    tools: undefined
  });
  const toolConfigurationFingerprint = await _fingerprint(
    input.context.tools ?? []
  );
  const identity = {
    agentSnapshotFingerprint,
    contextFingerprint,
    executionMode: input.executionMode,
    model: { provider: input.model.provider, id: input.model.id },
    reasoning: input.model.params?.reasoning,
    modelParams: input.model.params,
    toolConfigurationFingerprint,
    outputContract: input.outputContractSnapshot ?? null,
    maxStructuredOutputBytes: 256 * 1024
  };
  return {
    id: `configuration-${await _fingerprint(identity)}`,
    agentSnapshotFingerprint,
    contextFingerprint,
    executionMode: input.executionMode,
    model: identity.model,
    reasoning: input.model.params?.reasoning,
    toolConfigurationFingerprint,
    ...(input.outputContractSnapshot
      ? { outputContract: input.outputContractSnapshot }
      : {}),
    maxStructuredOutputBytes: 256 * 1024
  };
}

function _settleMutations(
  input: {
    readonly outcome:
      | "cancelled"
      | "completed"
      | "failed"
      | "outcomeUnknown";
    readonly runId: string;
  } & ThreadRuntimeExecutionInput
): Array<
  | {
    continuationFingerprint: string;
    runId: string;
    type: "recordCheckpoint";
  }
  | {
    runId: string;
    structuredOutput?: RuntimeStructuredOutputResult;
    to: RuntimeRunState;
    type: "transitionRun";
  }
> {
  if (input.outcome !== "completed") {
    return [{ type: "transitionRun", runId: input.runId, to: input.outcome }];
  }
  if (input.structuredOutput) {
    return [
      { type: "transitionRun", runId: input.runId, to: "runningTools" },
      {
        type: "transitionRun",
        runId: input.runId,
        to: "completed",
        structuredOutput: input.structuredOutput as RuntimeStructuredOutputResult
      }
    ];
  }
  const last = input.thread.context?.messages?.at(-1);
  if (last?.role !== "assistant" || !last.toolCalls?.length) {
    return [{ type: "transitionRun", runId: input.runId, to: "completed" }];
  }
  const waitingState = last.toolCalls.every(toolCall => toolCall.output)
    ? "waitingForContinue"
    : "waitingForToolResults";
  return [
    { type: "transitionRun", runId: input.runId, to: "runningTools" },
    { type: "transitionRun", runId: input.runId, to: waitingState }
  ];
}

function _hasCompleteTrailingToolResults(thread: Thread): boolean {
  const last = thread.context?.messages?.at(-1);
  return Boolean(
    last?.role === "assistant"
    && last.toolCalls?.length
    && last.toolCalls.every(toolCall => toolCall.output)
  );
}

function _asStoredRuntimeSession(value: unknown): StoredRuntimeSession {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SessionStoreInvariantError(
      "Runtime Session metadata must be an object"
    );
  }
  const record = value as Partial<StoredRuntimeSession>;
  if (
    !record.snapshot
    || !Array.isArray(record.snapshot.runs)
    || !Array.isArray(record.configurations)
    || !Array.isArray(record.journal)
  ) {
    throw new SessionStoreInvariantError(
      "Runtime Session metadata is missing snapshot, configurations, or journal"
    );
  }
  return value as StoredRuntimeSession;
}

async function _fingerprint(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(_canonical(value)));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}

function _canonical(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(_canonical);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, _canonical(child)])
    );
  }
  return value;
}
