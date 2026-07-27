import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import {
  chmod,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm
} from "node:fs/promises";
import { join } from "node:path";
import {
  type AgentServerRuntimeProjection,
  isRuntimeSessionBudgetWaitSnapshot,
  type ServerControlEvent,
  type ServerRunTerminalOutcome
} from "@llm-space/runtime/client";
import {
  InMemorySessionStore,
  isTerminalRuntimeRunState,
  runtimeHistoryMessages,
  type RuntimeJsonValue,
  type RuntimeRunConfigurationSnapshot,
  type RuntimeRunState,
  type RuntimeStructuredOutputResult,
  type RuntimeWorkingBase,
  type SessionStore,
  type SessionStoreCommit,
  type StoredRuntimeSession
} from "@llm-space/runtime/harness";
import { dlopen, FFIType } from "bun:ffi";

import type { FileHandle } from "node:fs/promises";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { UserMessage } from "@earendil-works/pi-ai";

import { ServerCursorError } from "./server-cursor-error";
import { ServerEventTooLargeError } from "./server-event-too-large-error";
import { ServerHiddenSessionError } from "./server-hidden-session-error";
import { ServerIdempotencyConflictError } from "./server-idempotency-conflict-error";
import { ServerRunConflictError } from "./server-run-conflict-error";

import type { ServerPrincipal } from "../auth/server-authenticator";

export { ServerCursorError } from "./server-cursor-error";
export { ServerHiddenSessionError } from "./server-hidden-session-error";
export { ServerIdempotencyConflictError } from "./server-idempotency-conflict-error";
export { ServerRunConflictError } from "./server-run-conflict-error";

const SERVER_SESSION_SCHEMA_VERSION = 1 as const;
const MIN_CONTINUATION_TTL_MS = 60 * 1_000;
const MAX_CONTINUATION_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const LOCK_EXCLUSIVE = 2;
const LOCK_NONBLOCKING = 4;

export type {
  ServerControlEvent,
  ServerRunTerminalOutcome
} from "@llm-space/runtime/client";

export interface PersistedServerEvent {
  readonly data: unknown;
  readonly event: "control" | "pi";
  readonly sequence: number;
}

export interface TransientServerEvent {
  readonly data: Extract<ServerControlEvent, { type: "serverShutdown"; }>;
  readonly event: "control";
  readonly sequence: null;
}

export type ObservedServerEvent = PersistedServerEvent | TransientServerEvent;

interface ServerContinuationState {
  readonly expiresAt: string;
  readonly generation: number;
  readonly hash: string;
  readonly revoked: boolean;
}

interface ServerRunRecord {
  readonly id: string;
  readonly idempotencyKey: string;
  readonly inputHash: string;
  readonly terminal: ServerRunTerminalOutcome | null;
  readonly outputContract?: string;
}

export interface ServerSubagentRunRecord {
  readonly artifactFingerprint: string;
  readonly child: { readonly runId: string; readonly sessionId: string; };
  readonly description: string;
  readonly message: string;
  readonly parent: {
    readonly runId: string;
    readonly sessionId: string;
    readonly toolCallId: string;
  };
  readonly runtime: StoredRuntimeSession;
  readonly sandbox: {
    readonly mode: "direct" | "isolated" | "shared";
    readonly revalidationFingerprint?: string;
  };
  readonly status:
    | "cancelled"
    | "completed"
    | "failed"
    | "outcomeUnknown"
    | "running"
    | "waitingForApproval"
    | "waitingForBudget"
    | "waitingForContinue"
    | "waitingForToolResults";
  readonly subagentId: string;
  readonly terminal?: {
    readonly error?: { readonly code: string; readonly message: string; };
    readonly result?: string;
    readonly status: "cancelled" | "completed" | "failed" | "outcomeUnknown";
  };
  readonly transcript: readonly AgentMessage[];
}

interface ServerRotationRecord {
  readonly expiresAt: string;
  readonly generation: number;
  readonly idempotencyKey: string;
  readonly nextHash: string;
  readonly previousHash: string;
}

interface ServerSessionEnvelope {
  readonly schemaVersion: typeof SERVER_SESSION_SCHEMA_VERSION;
  readonly revision: number;
  readonly artifactFingerprint: string;
  readonly sessionId: string;
  readonly owner: ServerPrincipal;
  readonly continuation: ServerContinuationState;
  readonly creation: {
    readonly continuationHash: string;
    readonly expiresAt: string;
    readonly idempotencyKey: string;
  };
  readonly createdAt: string;
  readonly runtime: StoredRuntimeSession | null;
  readonly transcript: readonly AgentMessage[];
  readonly runs: readonly ServerRunRecord[];
  readonly rotations: readonly ServerRotationRecord[];
  readonly events: Readonly<Record<string, readonly PersistedServerEvent[]>>;
  readonly subagentRuns: readonly ServerSubagentRunRecord[];
}

export interface CreatedServerSession {
  readonly schemaVersion: typeof SERVER_SESSION_SCHEMA_VERSION;
  readonly sessionId: string;
  readonly continuation: {
    readonly expiresAt: string;
    readonly generation: number;
  };
}

export interface CreatedServerRun {
  readonly created: boolean;
  readonly initiator: ServerPrincipal;
  readonly owner: ServerPrincipal;
  readonly runId: string;
  readonly sessionId: string;
  readonly transcript: readonly AgentMessage[];
  readonly turnSequence: number;
  readonly outputContract?: string;
}

export interface RotatedServerContinuation {
  readonly continuation: {
    readonly expiresAt: string;
    readonly generation: number;
  };
  readonly schemaVersion: typeof SERVER_SESSION_SCHEMA_VERSION;
  readonly sessionId: string;
}

export interface ObservedServerRun {
  readonly events: readonly PersistedServerEvent[];
  readonly terminal: boolean;
  unsubscribe(): void;
}

interface ServerObserver {
  readonly disconnect: () => void;
  readonly expiresAt: number;
  readonly listener: (event: ObservedServerEvent) => void;
  readonly runId: string;
  readonly sessionId: string;
  expiryTimer?: ReturnType<typeof setTimeout>;
}

export interface ServerSessionRepositoryOptions {
  readonly artifactFingerprint: string;
  readonly continuationTtlSeconds?: number;
  readonly root: string;
}

export class ServerSessionRepository implements SessionStore {
  private readonly _sessions = new Map<string, ServerSessionEnvelope>();
  private readonly _listeners = new Map<string, Set<ServerObserver>>();

  private _mutationTail: Promise<void> = Promise.resolve();

  private constructor(
    private readonly _root: string,
    private readonly _artifactFingerprint: string,
    private readonly _lockHandle: FileHandle,
    private readonly _continuationTtlMs: number
  ) {}

  static async open(
    options: ServerSessionRepositoryOptions
  ): Promise<ServerSessionRepository> {
    const continuationTtlMs = (options.continuationTtlSeconds ?? 86_400)
      * 1_000;
    if (
      !Number.isInteger(continuationTtlMs)
      || continuationTtlMs < MIN_CONTINUATION_TTL_MS
      || continuationTtlMs > MAX_CONTINUATION_TTL_MS
    ) {
      throw new TypeError(
        "continuationTtlSeconds must be an integer from 60 through 2592000"
      );
    }
    await mkdir(options.root, { recursive: true, mode: 0o700 });
    await chmod(options.root, 0o700);
    const lockPath = join(options.root, ".owner-lock");
    const lockHandle = await _acquireOwnerLock(lockPath);
    const repository = new ServerSessionRepository(
      options.root,
      options.artifactFingerprint,
      lockHandle,
      continuationTtlMs
    );
    try {
      for (const entry of await readdir(options.root, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith(".json")) {
          continue;
        }
        const path = join(options.root, entry.name);
        await chmod(path, 0o600);
        const envelope = _parseEnvelope(
          await readFile(path, "utf8"),
          entry.name
        );
        if (envelope.artifactFingerprint !== options.artifactFingerprint) {
          throw new Error("Stored Server Session belongs to another artifact");
        }
        if (envelope.runtime) {
          await new InMemorySessionStore([envelope.runtime]).load(
            envelope.sessionId
          );
        }
        for (const child of envelope.subagentRuns) {
          await new InMemorySessionStore([child.runtime]).load(
            child.child.sessionId
          );
        }
        _assertTerminalAuthority(envelope);
        repository._sessions.set(envelope.sessionId, envelope);
      }
      return repository;
    } catch (error) {
      await lockHandle.close();
      throw error;
    }
  }

  async createSession(input: {
    readonly continuationToken: string;
    readonly idempotencyKey: string;
    readonly owner: ServerPrincipal;
  }): Promise<CreatedServerSession> {
    _assertContinuationToken(input.continuationToken);
    const continuationHash = _sha256(input.continuationToken);
    return this._exclusive(async () => {
      const existing = [...this._sessions.values()].find(session =>
        session.creation.idempotencyKey === input.idempotencyKey
        && _samePrincipal(session.owner, input.owner));
      if (existing) {
        if (existing.creation.continuationHash !== continuationHash) {
          throw new ServerIdempotencyConflictError();
        }
        return _createdSession(existing, existing.creation.expiresAt);
      }
      const sessionId = `session-${randomUUID()}`;
      const expiresAt = new Date(Date.now() + this._continuationTtlMs)
        .toISOString();
      const envelope: ServerSessionEnvelope = {
        schemaVersion: SERVER_SESSION_SCHEMA_VERSION,
        revision: 0,
        artifactFingerprint: this._artifactFingerprint,
        sessionId,
        owner: _principal(input.owner),
        continuation: {
          generation: 1,
          expiresAt,
          hash: continuationHash,
          revoked: false
        },
        creation: {
          continuationHash,
          expiresAt,
          idempotencyKey: input.idempotencyKey
        },
        createdAt: new Date().toISOString(),
        runtime: null,
        transcript: [],
        runs: [],
        rotations: [],
        events: {},
        subagentRuns: []
      };
      await this._save(envelope);
      return _createdSession(envelope, expiresAt);
    });
  }

  async createRun(input: {
    readonly configuration: RuntimeRunConfigurationSnapshot;
    readonly continuationToken: string;
    readonly idempotencyKey: string;
    readonly inputText: string;
    readonly outputContract?: string;
    readonly owner: ServerPrincipal;
    readonly sessionId: string;
    readonly userMessage: UserMessage;
    readonly workingBase?: RuntimeWorkingBase;
  }): Promise<CreatedServerRun> {
    return this._exclusive(async () => {
      const current = this._authorized(
        input.sessionId,
        input.owner,
        input.continuationToken
      );
      const inputHash = _runInputHash(
        input.inputText,
        input.outputContract,
        input.workingBase
      );
      const idempotent = current.runs.find(
        run => run.idempotencyKey === input.idempotencyKey
      );
      if (idempotent) {
        if (idempotent.inputHash !== inputHash) {
          throw new ServerIdempotencyConflictError();
        }
        return {
          created: false,
          initiator: _principal(current.owner),
          owner: _principal(input.owner),
          sessionId: current.sessionId,
          runId: idempotent.id,
          transcript: _snapshot(current.transcript),
          turnSequence: current.runs.findIndex(run => run.id === idempotent.id) + 1,
          ...(idempotent.outputContract
            ? { outputContract: idempotent.outputContract }
            : {})
        };
      }
      if (current.runtime?.snapshot.activeRunId) {
        throw new ServerRunConflictError();
      }
      const runId = `run-${randomUUID()}`;
      const transcript: readonly AgentMessage[] = [
        ..._transcriptAtWorkingBase(current, input.workingBase),
        input.userMessage
      ];
      const store = new InMemorySessionStore(
        current.runtime ? [current.runtime] : []
      );
      const runtime = await store.commit({
        sessionId: current.sessionId,
        expectedVersion: current.runtime?.version ?? null,
        mutations: [{
          type: "startRun",
          runId,
          configuration: input.configuration,
          messages: transcript as unknown as readonly RuntimeJsonValue[],
          ...(input.workingBase ? { workingBase: input.workingBase } : {})
        }]
      });
      const next: ServerSessionEnvelope = {
        ...current,
        runtime,
        transcript,
        runs: [
          ...current.runs,
          {
            id: runId,
            idempotencyKey: input.idempotencyKey,
            inputHash,
            terminal: null,
            ...(input.outputContract
              ? { outputContract: input.outputContract }
              : {})
          }
        ],
        events: { ...current.events, [runId]: [] }
      };
      await this._save(next);
      return {
        created: true,
        initiator: _principal(next.owner),
        owner: _principal(input.owner),
        sessionId: next.sessionId,
        runId,
        transcript: _snapshot(transcript),
        turnSequence: next.runs.length,
        ...(input.outputContract ? { outputContract: input.outputContract } : {})
      };
    });
  }

  async findIdempotentRun(input: {
    readonly continuationToken: string;
    readonly idempotencyKey: string;
    readonly inputText: string;
    readonly outputContract?: string;
    readonly owner: ServerPrincipal;
    readonly sessionId: string;
    readonly workingBase?: RuntimeWorkingBase;
  }): Promise<CreatedServerRun | null> {
    const current = this._authorized(
      input.sessionId,
      input.owner,
      input.continuationToken
    );
    const run = current.runs.find(
      candidate => candidate.idempotencyKey === input.idempotencyKey
    );
    if (!run) {
      return null;
    }
    if (run.inputHash !== _runInputHash(
      input.inputText,
      input.outputContract,
      input.workingBase
    )) {
      throw new ServerIdempotencyConflictError();
    }
    return {
      created: false,
      initiator: _principal(current.owner),
      owner: _principal(input.owner),
      sessionId: current.sessionId,
      runId: run.id,
      transcript: _snapshot(current.transcript),
      turnSequence: current.runs.findIndex(candidate => candidate.id === run.id) + 1,
      ...(run.outputContract ? { outputContract: run.outputContract } : {})
    };
  }

  authorizedTranscript(input: {
    readonly continuationToken: string;
    readonly owner: ServerPrincipal;
    readonly sessionId: string;
    readonly workingBase?: RuntimeWorkingBase;
  }): readonly AgentMessage[] {
    const current = this._authorized(
      input.sessionId,
      input.owner,
      input.continuationToken
    );
    return _snapshot(_transcriptAtWorkingBase(current, input.workingBase));
  }

  async renameBranch(input: {
    readonly branchId: string;
    readonly continuationToken: string;
    readonly label: string;
    readonly owner: ServerPrincipal;
    readonly sessionId: string;
  }): Promise<StoredRuntimeSession> {
    return this._exclusive(async () => {
      const current = this._authorized(
        input.sessionId,
        input.owner,
        input.continuationToken
      );
      if (!current.runtime) {
        throw new TypeError("Runtime Session is unavailable");
      }
      const store = new InMemorySessionStore([current.runtime]);
      const runtime = await store.commit({
        sessionId: input.sessionId,
        expectedVersion: current.runtime.version,
        mutations: [{
          type: "renameBranch",
          branchId: input.branchId,
          label: input.label
        }]
      });
      await this._save({ ...current, runtime });
      return _snapshot(runtime);
    });
  }

  async authorizeRun(input: {
    readonly continuationToken: string;
    readonly owner: ServerPrincipal;
    readonly runId: string;
    readonly sessionId: string;
  }): Promise<void> {
    const current = this._authorized(
      input.sessionId,
      input.owner,
      input.continuationToken
    );
    if (!current.runs.some(run => run.id === input.runId)) {
      throw new ServerHiddenSessionError();
    }
  }

  authorizeContinuationRotation(input: {
    readonly continuationToken: string;
    readonly idempotencyKey: string;
    readonly nextContinuationToken: string;
    readonly owner: ServerPrincipal;
    readonly sessionId: string;
  }): void {
    _assertContinuationToken(input.nextContinuationToken);
    const current = this._sessions.get(input.sessionId);
    if (!current || !_samePrincipal(current.owner, input.owner)) {
      throw new ServerHiddenSessionError();
    }
    const presentedHash = _sha256(input.continuationToken);
    const nextHash = _sha256(input.nextContinuationToken);
    const replay = current.rotations.find(
      rotation => rotation.idempotencyKey === input.idempotencyKey
    );
    if (!replay) {
      this._authorized(
        input.sessionId,
        input.owner,
        input.continuationToken
      );
      return;
    }
    if (
      (replay.previousHash !== presentedHash
        && replay.nextHash !== presentedHash)
      || current.continuation.revoked
      || current.continuation.generation !== replay.generation
      || current.continuation.hash !== replay.nextHash
      || Date.parse(current.continuation.expiresAt) <= Date.now()
    ) {
      throw new ServerHiddenSessionError();
    }
    if (replay.nextHash !== nextHash) {
      throw new ServerIdempotencyConflictError();
    }
  }

  async rotateContinuation(input: {
    readonly continuationToken: string;
    readonly idempotencyKey: string;
    readonly nextContinuationToken: string;
    readonly owner: ServerPrincipal;
    readonly sessionId: string;
  }): Promise<RotatedServerContinuation> {
    _assertContinuationToken(input.nextContinuationToken);
    return this._exclusive(async () => {
      const current = this._sessions.get(input.sessionId);
      if (!current || !_samePrincipal(current.owner, input.owner)) {
        throw new ServerHiddenSessionError();
      }
      const presentedHash = _sha256(input.continuationToken);
      const nextHash = _sha256(input.nextContinuationToken);
      const replay = current.rotations.find(
        rotation => rotation.idempotencyKey === input.idempotencyKey
      );
      if (replay) {
        if (
          replay.previousHash !== presentedHash
          && replay.nextHash !== presentedHash
        ) {
          throw new ServerHiddenSessionError();
        }
        if (replay.nextHash !== nextHash) {
          throw new ServerIdempotencyConflictError();
        }
        if (
          current.continuation.revoked
          || current.continuation.generation !== replay.generation
          || current.continuation.hash !== replay.nextHash
          || Date.parse(current.continuation.expiresAt) <= Date.now()
        ) {
          throw new ServerHiddenSessionError();
        }
        return _rotatedContinuation(current, replay);
      }
      const authorized = this._authorized(
        input.sessionId,
        input.owner,
        input.continuationToken
      );
      if (_equalHash(authorized.continuation.hash, nextHash)) {
        throw new TypeError("Next continuation token must differ");
      }
      const rotation: ServerRotationRecord = {
        idempotencyKey: input.idempotencyKey,
        previousHash: authorized.continuation.hash,
        nextHash,
        generation: authorized.continuation.generation + 1,
        expiresAt: new Date(Date.now() + this._continuationTtlMs)
          .toISOString()
      };
      const next = {
        ...authorized,
        continuation: {
          generation: rotation.generation,
          expiresAt: rotation.expiresAt,
          hash: rotation.nextHash,
          revoked: false
        },
        rotations: [...authorized.rotations, rotation]
      };
      await this._save(next);
      return _rotatedContinuation(next, rotation);
    });
  }

  async revokeContinuation(input: {
    readonly continuationToken: string;
    readonly owner: ServerPrincipal;
    readonly sessionId: string;
  }): Promise<void> {
    await this._exclusive(async () => {
      const current = this._sessions.get(input.sessionId);
      if (
        !current
        || !_samePrincipal(current.owner, input.owner)
        || current.continuation.revoked
        || Date.parse(current.continuation.expiresAt) <= Date.now()
        || !_equalHash(
          current.continuation.hash,
          _sha256(input.continuationToken)
        )
      ) {
        throw new ServerHiddenSessionError();
      }
      if (!current.continuation.revoked) {
        await this._save({
          ...current,
          continuation: { ...current.continuation, revoked: true }
        });
        this._disconnectSessionObservers(current.sessionId);
      }
    });
  }

  async runTerminal(input: {
    readonly continuationToken: string;
    readonly owner: ServerPrincipal;
    readonly runId: string;
    readonly sessionId: string;
  }): Promise<ServerRunTerminalOutcome | null> {
    return this._exclusive(async () => {
      const current = this._authorized(
        input.sessionId,
        input.owner,
        input.continuationToken
      );
      const run = current.runs.find(item => item.id === input.runId);
      if (!run) {
        throw new ServerHiddenSessionError();
      }
      return run.terminal;
    });
  }

  async replaceTranscript(
    sessionId: string,
    messages: readonly AgentMessage[]
  ): Promise<void> {
    await this._exclusive(async () => {
      const current = this._required(sessionId);
      await this._save({ ...current, transcript: _snapshot(messages) });
    });
  }

  async appendEvent(
    sessionId: string,
    runId: string,
    event: Omit<PersistedServerEvent, "sequence">
  ): Promise<PersistedServerEvent> {
    return this._exclusive(async () => {
      const current = this._requiredRun(sessionId, runId);
      const events = current.events[runId] ?? [];
      const persisted = _snapshot({ ...event, sequence: events.length + 1 });
      if (_persistedEventWireByteLength(persisted) > 1024 * 1024) {
        throw new ServerEventTooLargeError();
      }
      await this._save({
        ...current,
        events: { ...current.events, [runId]: [...events, persisted] }
      });
      this._notify(runId, persisted);
      return persisted;
    });
  }

  async completeRun(input: {
    readonly code?: string;
    readonly outcome: ServerRunTerminalOutcome;
    readonly runId: string;
    readonly sessionId: string;
    readonly structuredOutput?: RuntimeStructuredOutputResult;
  }): Promise<PersistedServerEvent> {
    return this._exclusive(async () => {
      const current = this._requiredRun(input.sessionId, input.runId);
      const record = current.runs.find(run => run.id === input.runId);
      if (!record) {
        throw new Error("Server Run disappeared from its Session");
      }
      const existingTerminal = (current.events[input.runId] ?? []).find(
        event => event.event === "control"
          && (event.data as { type?: string; }).type === "runTerminal"
      );
      if (existingTerminal) {
        return existingTerminal;
      }
      const currentRuntime = current.runtime;
      if (!currentRuntime) {
        throw new Error("Runtime Session disappeared from Server Session");
      }
      const runtimeRun = currentRuntime.snapshot.runs.find(
        run => run.id === input.runId
      );
      if (!runtimeRun) {
        throw new Error("Runtime Run disappeared from its Session");
      }
      let runtime = currentRuntime;
      if (!isTerminalRuntimeRunState(runtimeRun.state)) {
        const runtimeStore = new InMemorySessionStore([currentRuntime]);
        runtime = await runtimeStore.commit({
          sessionId: input.sessionId,
          expectedVersion: currentRuntime.version,
          mutations: [
            {
              type: "transitionRun",
              runId: input.runId,
              to: input.outcome as RuntimeRunState,
              ...(input.structuredOutput
                ? { structuredOutput: input.structuredOutput }
                : {})
            },
            {
              type: "recordCheckpoint",
              runId: input.runId,
              messages: current.transcript as unknown as readonly RuntimeJsonValue[],
              continuationFingerprint:
                `server-transcript:${_sha256(JSON.stringify(current.transcript))}`
            }
          ]
        });
      } else if (runtimeRun.state !== input.outcome) {
        throw new Error("Runtime Run terminal does not match Server terminal");
      } else if (runtimeRun.checkpoint?.state !== runtimeRun.state) {
        const runtimeStore = new InMemorySessionStore([currentRuntime]);
        runtime = await runtimeStore.commit({
          sessionId: input.sessionId,
          expectedVersion: currentRuntime.version,
          mutations: [{
            type: "recordCheckpoint",
            runId: input.runId,
            messages: current.transcript as unknown as readonly RuntimeJsonValue[],
            continuationFingerprint:
              `server-transcript:${_sha256(JSON.stringify(current.transcript))}`
          }]
        });
      }
      const authoritativeRun = runtime.snapshot.runs.find(
        run => run.id === input.runId
      );
      if (!authoritativeRun) {
        throw new Error("Runtime Run disappeared after terminal commit");
      }
      if (
        input.structuredOutput
        && !_sameStructuredOutput(
          input.structuredOutput,
          authoritativeRun.structuredOutput
        )
      ) {
        throw new Error(
          "Server structured output does not match Runtime Run terminal"
        );
      }
      const events = current.events[input.runId] ?? [];
      const runtimeProjection = _terminalRuntimeProjection(
        runtime,
        authoritativeRun,
        current.subagentRuns
      );
      if (!runtimeProjection) {
        throw new Error(
          `Runtime Run ${authoritativeRun.id} has no terminal checkpoint`
        );
      }
      const data: ServerControlEvent = {
        type: "runTerminal",
        outcome: input.outcome,
        runtime: runtimeProjection,
        ...(input.code ? { code: input.code } : {}),
        ...(authoritativeRun.structuredOutput
          ? { structuredOutput: authoritativeRun.structuredOutput }
          : {})
      };
      const terminal: PersistedServerEvent = _snapshot({
        event: "control" as const,
        data,
        sequence: events.length + 1
      });
      await this._save({
        ...current,
        runtime,
        runs: current.runs.map(run =>
          (run.id === record.id ? { ...run, terminal: input.outcome } : run)),
        events: { ...current.events, [input.runId]: [...events, terminal] }
      });
      this._notify(input.runId, terminal);
      return terminal;
    });
  }

  async observeRun(input: {
    readonly afterSequence?: number;
    readonly continuationToken: string;
    readonly disconnect: () => void;
    readonly listener: (event: ObservedServerEvent) => void;
    readonly owner: ServerPrincipal;
    readonly runId: string;
    readonly sessionId: string;
  }): Promise<ObservedServerRun> {
    return this._exclusive(async () => {
      const current = this._authorized(
        input.sessionId,
        input.owner,
        input.continuationToken
      );
      const run = current.runs.find(item => item.id === input.runId);
      if (!run) {
        throw new ServerHiddenSessionError();
      }
      const events = current.events[input.runId] ?? [];
      const afterSequence = input.afterSequence ?? 0;
      if (
        afterSequence !== 0
        && events[afterSequence - 1]?.sequence !== afterSequence
      ) {
        throw new ServerCursorError();
      }
      const terminal = run.terminal !== null;
      let observer: ServerObserver | null = null;
      if (!terminal) {
        const listeners = this._listeners.get(input.runId) ?? new Set();
        observer = {
          disconnect: input.disconnect,
          expiresAt: Date.parse(current.continuation.expiresAt),
          listener: input.listener,
          runId: input.runId,
          sessionId: input.sessionId
        };
        listeners.add(observer);
        this._listeners.set(input.runId, listeners);
        this._scheduleObserverExpiry(observer);
      }
      return {
        events: _snapshot(events.filter(event => event.sequence > afterSequence)),
        terminal,
        unsubscribe: () => {
          if (observer) {
            this._removeObserver(observer, false);
          }
        }
      };
    });
  }

  async load(sessionId: string): Promise<StoredRuntimeSession | null> {
    const runtime = this._sessions.get(sessionId)?.runtime
      ?? this._subagent(sessionId)?.record.runtime
      ?? null;
    return runtime ? _snapshot(runtime) : null;
  }

  async createSubagentRun(
    parentSessionId: string,
    create: () => Promise<ServerSubagentRunRecord>
  ): Promise<{ readonly created: boolean; readonly record: ServerSubagentRunRecord; }> {
    return this._exclusive(async () => {
      const current = this._required(parentSessionId);
      const candidate = await create();
      const existing = current.subagentRuns.find(run =>
        run.child.sessionId === candidate.child.sessionId
        && run.child.runId === candidate.child.runId);
      if (existing) { return { created: false, record: _snapshot(existing) }; }
      const next = {
        ...current,
        subagentRuns: [...current.subagentRuns, candidate]
      };
      await this._save(next);
      return { created: true, record: _snapshot(candidate) };
    });
  }

  async loadSubagentRun(
    parentSessionId: string,
    childSessionId: string
  ): Promise<ServerSubagentRunRecord | null> {
    const current = this._required(parentSessionId);
    const record = current.subagentRuns.find(
      run => run.child.sessionId === childSessionId
    );
    return record ? _snapshot(record) : null;
  }

  subagentRuns(parentSessionId: string): readonly ServerSubagentRunRecord[] {
    return _snapshot(this._required(parentSessionId).subagentRuns);
  }

  subagentRunForParent(
    parentSessionId: string,
    parentRunId: string
  ): ServerSubagentRunRecord | null {
    const record = this._required(parentSessionId).subagentRuns.findLast(
      run => run.parent.runId === parentRunId
    );
    return record ? _snapshot(record) : null;
  }

  async replaceSubagentTranscript(
    childSessionId: string,
    transcript: readonly AgentMessage[]
  ): Promise<void> {
    await this._updateSubagent(childSessionId, record => ({
      ...record,
      transcript: _snapshot(transcript)
    }));
  }

  async finishSubagentRun(
    childSessionId: string,
    terminal: NonNullable<ServerSubagentRunRecord["terminal"]>
  ): Promise<void> {
    await this._updateSubagent(childSessionId, record => ({
      ...record,
      status: terminal.status,
      terminal
    }));
  }

  async parkSubagentRun(
    childSessionId: string,
    status: Extract<ServerSubagentRunRecord["status"], `waiting${string}`>
  ): Promise<void> {
    await this._updateSubagent(childSessionId, record => ({
      ...record,
      status
    }));
  }

  sessionIds(): readonly string[] {
    return [...this._sessions.keys()];
  }

  pendingRuntimeTerminals(sessionId: string): ReadonlyArray<{
    readonly code?: string;
    readonly outcome: ServerRunTerminalOutcome;
    readonly runId: string;
  }> {
    const current = this._required(sessionId);
    return current.runs.flatMap(record => {
      if (record.terminal !== null) { return []; }
      const runtimeRun = current.runtime?.snapshot.runs.find(
        run => run.id === record.id
      );
      const outcome = runtimeRun
        ? _serverTerminalOutcome(runtimeRun.state)
        : null;
      if (!runtimeRun || !outcome) { return []; }
      return [{
        runId: runtimeRun.id,
        outcome,
        ...(runtimeRun.failure
          ? { code: runtimeRun.failure.code }
          : outcome === "outcomeUnknown"
            ? { code: "process_interrupted" }
            : {})
      }];
    });
  }

  recoverableRun(sessionId: string, runId: string): CreatedServerRun {
    const current = this._required(sessionId);
    const run = current.runs.find(item => item.id === runId);
    if (run?.terminal !== null) {
      throw new Error(
        `Server Run ${runId} is not recoverable in Session ${sessionId}`
      );
    }
    return {
      created: true,
      initiator: _principal(current.owner),
      owner: _principal(current.owner),
      sessionId,
      runId,
      transcript: _snapshot(_recoverableTranscript(current, runId)),
      turnSequence: current.runs.findIndex(item => item.id === runId) + 1,
      ...(run.outputContract ? { outputContract: run.outputContract } : {})
    };
  }

  notifyShutdown(retryAfterSeconds: number): void {
    const event: TransientServerEvent = {
      sequence: null,
      event: "control",
      data: { type: "serverShutdown", retryAfterSeconds }
    };
    for (const listeners of this._listeners.values()) {
      for (const observer of listeners) {
        try {
          observer.listener(event);
        } catch {}
      }
    }
  }

  async commit(input: SessionStoreCommit): Promise<StoredRuntimeSession> {
    return this._exclusive(async () => {
      const child = this._subagent(input.sessionId);
      if (child) {
        const store = new InMemorySessionStore([child.record.runtime]);
        const runtime = await store.commit(input);
        const next = {
          ...child.envelope,
          subagentRuns: child.envelope.subagentRuns.map(record => (
            record.child.sessionId === input.sessionId
              ? {
                ...record,
                runtime,
                status: _subagentStatus(runtime, record.child.runId)
              }
              : record))
        };
        await this._save(next);
        return runtime;
      }
      const current = this._required(input.sessionId);
      const store = new InMemorySessionStore(
        current.runtime ? [current.runtime] : []
      );
      const runtime = await store.commit(input);
      let runs = current.runs;
      let events = current.events;
      const addedTerminals: PersistedServerEvent[] = [];
      for (const runtimeRun of runtime.snapshot.runs) {
        const outcome = _serverTerminalOutcome(runtimeRun.state);
        const record = runs.find(run => run.id === runtimeRun.id);
        const runtimeProjection = _terminalRuntimeProjection(
          runtime,
          runtimeRun,
          current.subagentRuns
        );
        if (!outcome || record?.terminal !== null || !runtimeProjection) {
          continue;
        }
        const runEvents = events[runtimeRun.id] ?? [];
        const terminal: PersistedServerEvent = _snapshot({
          event: "control" as const,
          data: {
            type: "runTerminal" as const,
            outcome,
            ...(runtimeRun.failure
              ? { code: runtimeRun.failure.code }
              : outcome === "outcomeUnknown"
                ? { code: "process_interrupted" }
                : {}),
            ...(runtimeRun.structuredOutput
              ? { structuredOutput: runtimeRun.structuredOutput }
              : {}),
            runtime: runtimeProjection
          },
          sequence: runEvents.length + 1
        });
        runs = runs.map(run => (run.id === runtimeRun.id
          ? { ...run, terminal: outcome }
          : run));
        events = {
          ...events,
          [runtimeRun.id]: [...runEvents, terminal]
        };
        addedTerminals.push(terminal);
      }
      await this._save({ ...current, runtime, runs, events });
      for (const terminal of addedTerminals) {
        const runtimeRun = runtime.snapshot.runs.find(run =>
          _serverTerminalOutcome(run.state)
          && events[run.id]?.at(-1) === terminal);
        if (runtimeRun) {
          this._notify(runtimeRun.id, terminal);
        }
      }
      return runtime;
    });
  }

  async close(): Promise<void> {
    await this._mutationTail;
    for (const listeners of this._listeners.values()) {
      for (const observer of listeners) {
        if (observer.expiryTimer) {
          clearTimeout(observer.expiryTimer);
        }
      }
    }
    this._listeners.clear();
    await this._lockHandle.close();
  }

  private _authorized(
    sessionId: string,
    owner: ServerPrincipal,
    continuationToken: string
  ): ServerSessionEnvelope {
    const current = this._sessions.get(sessionId);
    if (
      !current
      || !_samePrincipal(current.owner, owner)
      || current.continuation.revoked
      || Date.parse(current.continuation.expiresAt) <= Date.now()
      || !_equalHash(current.continuation.hash, _sha256(continuationToken))
    ) {
      throw new ServerHiddenSessionError();
    }
    return current;
  }

  private _required(sessionId: string): ServerSessionEnvelope {
    const current = this._sessions.get(sessionId);
    if (!current) {
      throw new Error("Server Session disappeared from its repository");
    }
    return current;
  }

  private _subagent(childSessionId: string): {
    readonly envelope: ServerSessionEnvelope;
    readonly record: ServerSubagentRunRecord;
  } | null {
    for (const envelope of this._sessions.values()) {
      const record = envelope.subagentRuns.find(
        run => run.child.sessionId === childSessionId
      );
      if (record) { return { envelope, record }; }
    }
    return null;
  }

  private async _updateSubagent(
    childSessionId: string,
    update: (record: ServerSubagentRunRecord) => ServerSubagentRunRecord
  ): Promise<void> {
    await this._exclusive(async () => {
      const child = this._subagent(childSessionId);
      if (!child) { throw new Error("Server Subagent Run disappeared"); }
      await this._save({
        ...child.envelope,
        subagentRuns: child.envelope.subagentRuns.map(record => (
          record.child.sessionId === childSessionId ? update(record) : record))
      });
    });
  }

  private _requiredRun(
    sessionId: string,
    runId: string
  ): ServerSessionEnvelope {
    const current = this._required(sessionId);
    if (!current.runs.some(run => run.id === runId)) {
      throw new Error("Server Run disappeared from its Session");
    }
    return current;
  }

  private async _save(envelope: ServerSessionEnvelope): Promise<void> {
    const current = this._sessions.get(envelope.sessionId);
    if (
      (current && current.revision !== envelope.revision)
      || (!current && envelope.revision !== 0)
    ) {
      throw new Error("Server Session envelope revision conflict");
    }
    const fileName = `${envelope.sessionId}.json`;
    let persisted: ServerSessionEnvelope | null = null;
    try {
      persisted = _parseEnvelope(
        await readFile(join(this._root, fileName), "utf8"),
        fileName
      );
    } catch (error) {
      if (!_hasCode(error, "ENOENT")) {
        throw error;
      }
    }
    if (
      (current && persisted?.revision !== current.revision)
      || (!current && persisted !== null)
    ) {
      throw new Error("Server Session persisted revision conflict");
    }
    const snapshot = _snapshot({
      ...envelope,
      revision: envelope.revision + 1
    });
    await this._writeEnvelope(snapshot);
    this._sessions.set(snapshot.sessionId, snapshot);
  }

  private async _exclusive<T>(action: () => Promise<T>): Promise<T> {
    const result = this._mutationTail.then(action);
    this._mutationTail = result.then(() => {}, () => {});
    return result;
  }

  private _notify(runId: string, event: PersistedServerEvent): void {
    for (const observer of this._listeners.get(runId) ?? []) {
      try {
        observer.listener(event);
      } catch {}
    }
  }

  private _disconnectSessionObservers(sessionId: string): void {
    const observers = [...this._listeners.values()]
      .flatMap(listeners => [...listeners])
      .filter(observer => observer.sessionId === sessionId);
    for (const observer of observers) {
      this._removeObserver(observer, true);
    }
  }

  private _removeObserver(observer: ServerObserver, disconnect: boolean): void {
    if (observer.expiryTimer) {
      clearTimeout(observer.expiryTimer);
    }
    const listeners = this._listeners.get(observer.runId);
    listeners?.delete(observer);
    if (listeners?.size === 0) {
      this._listeners.delete(observer.runId);
    }
    if (disconnect) {
      try {
        observer.disconnect();
      } catch {}
    }
  }

  private _scheduleObserverExpiry(observer: ServerObserver): void {
    if (!this._listeners.get(observer.runId)?.has(observer)) {
      return;
    }
    const remaining = observer.expiresAt - Date.now();
    if (remaining <= 0) {
      this._removeObserver(observer, true);
      return;
    }
    observer.expiryTimer = setTimeout(
      () => { this._scheduleObserverExpiry(observer); },
      Math.min(remaining, 2_147_483_647)
    );
  }

  private async _writeEnvelope(envelope: ServerSessionEnvelope): Promise<void> {
    const path = join(this._root, `${envelope.sessionId}.json`);
    const temporaryPath = `${path}.${randomUUID()}.tmp`;
    const handle = await open(temporaryPath, "wx", 0o600);
    try {
      try {
        await handle.writeFile(`${JSON.stringify(envelope)}\n`, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporaryPath, path);
      const directory = await open(this._root, "r");
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    } catch (error) {
      await rm(temporaryPath, { force: true });
      throw error;
    }
  }
}

function _parseEnvelope(source: string, fileName: string): ServerSessionEnvelope {
  let value: unknown;
  try {
    value = JSON.parse(source) as unknown;
  } catch {
    throw new Error("Stored Server Session is not valid JSON");
  }
  if (!_isRecord(value) || value.schemaVersion !== SERVER_SESSION_SCHEMA_VERSION) {
    throw new Error("Stored Server Session has an unsupported schema version");
  }
  if (
    !Number.isSafeInteger(value.revision)
    || (value.revision as number) < 1
    || typeof value.artifactFingerprint !== "string"
    || typeof value.sessionId !== "string"
    || !/^session-[0-9a-f-]{36}$/.test(value.sessionId)
    || fileName !== `${value.sessionId}.json`
    || !_validPrincipal(value.owner)
    || !_validContinuation(value.continuation)
    || !_validCreation(value.creation)
    || typeof value.createdAt !== "string"
    || !Number.isFinite(Date.parse(value.createdAt))
    || (value.runtime !== null && !_isRecord(value.runtime))
    || !Array.isArray(value.transcript)
    || !value.transcript.every(_validTranscriptMessage)
    || !Array.isArray(value.runs)
    || !value.runs.every(_validRunRecord)
    || !Array.isArray(value.rotations)
    || !value.rotations.every(_validRotationRecord)
    || (value.subagentRuns !== undefined && (
      !Array.isArray(value.subagentRuns)
      || !value.subagentRuns.every(_validSubagentRunRecord)
    ))
    || !_validEventMap(value.events, value.runs)
  ) {
    throw new Error("Stored Server Session does not match schema version 1");
  }
  return {
    ...(value as unknown as ServerSessionEnvelope),
    subagentRuns: value.subagentRuns ?? []
  };
}

function _validPrincipal(value: unknown): value is ServerPrincipal {
  if (!_isRecord(value)) { return false; }
  const keys = Object.keys(value);
  return (keys.length === 3 || (keys.length === 4 && value.tenant !== undefined))
    && keys.every(key => [
      "issuer",
      "principalId",
      "principalType",
      "tenant"
    ].includes(key))
    && typeof value.issuer === "string"
    && value.issuer.length > 0
    && value.issuer.length <= 256
    && typeof value.principalId === "string"
    && value.principalId.length > 0
    && value.principalId.length <= 256
    && (value.principalType === "service" || value.principalType === "user")
    && (value.tenant === undefined || (
      _isRecord(value.tenant)
      && Object.keys(value.tenant).length === 2
      && typeof value.tenant.issuer === "string"
      && value.tenant.issuer.length > 0
      && value.tenant.issuer.length <= 256
      && typeof value.tenant.tenantId === "string"
      && value.tenant.tenantId.length > 0
      && value.tenant.tenantId.length <= 256
    ));
}

function _principal(value: ServerPrincipal): ServerPrincipal {
  const principal: ServerPrincipal = {
    issuer: value.issuer,
    principalId: value.principalId,
    principalType: value.principalType,
    ...(value.tenant ? { tenant: { ...value.tenant } } : {})
  };
  if (!_validPrincipal(principal)) {
    throw new TypeError("Server principal has an invalid identity");
  }
  return principal;
}

function _validContinuation(value: unknown): value is ServerContinuationState {
  return _isRecord(value)
    && typeof value.expiresAt === "string"
    && Number.isFinite(Date.parse(value.expiresAt))
    && Number.isSafeInteger(value.generation)
    && (value.generation as number) >= 1
    && _isSha256(value.hash)
    && typeof value.revoked === "boolean";
}

function _validCreation(
  value: unknown
): value is ServerSessionEnvelope["creation"] {
  return _isRecord(value)
    && _isSha256(value.continuationHash)
    && typeof value.expiresAt === "string"
    && Number.isFinite(Date.parse(value.expiresAt))
    && typeof value.idempotencyKey === "string"
    && value.idempotencyKey.length > 0;
}

function _validRunRecord(value: unknown): value is ServerRunRecord {
  return _isRecord(value)
    && typeof value.id === "string"
    && /^run-[0-9a-f-]{36}$/.test(value.id)
    && typeof value.idempotencyKey === "string"
    && value.idempotencyKey.length > 0
    && _isSha256(value.inputHash)
    && (
      value.outputContract === undefined
      || (typeof value.outputContract === "string"
        && value.outputContract.length > 0
        && value.outputContract.length <= 128)
    )
    && (
      value.terminal === null
      || value.terminal === "cancelled"
      || value.terminal === "completed"
      || value.terminal === "failed"
      || value.terminal === "outcomeUnknown"
    );
}

function _validSubagentRunRecord(
  value: unknown
): value is ServerSubagentRunRecord {
  if (
    !_isRecord(value)
    || !_isRecord(value.child)
    || !/^subagent-session-[0-9a-f]{64}$/.test(String(value.child.sessionId))
    || !/^subagent-run-[0-9a-f]{64}$/.test(String(value.child.runId))
    || !_isRecord(value.parent)
    || typeof value.parent.sessionId !== "string"
    || typeof value.parent.runId !== "string"
    || typeof value.parent.toolCallId !== "string"
    || typeof value.artifactFingerprint !== "string"
    || typeof value.description !== "string"
    || typeof value.message !== "string"
    || typeof value.subagentId !== "string"
    || !_isRecord(value.sandbox)
    || !["direct", "isolated", "shared"].includes(String(value.sandbox.mode))
    || !_isRecord(value.runtime)
    || !Array.isArray(value.transcript)
    || !value.transcript.every(_validTranscriptMessage)
    || ![
      "cancelled",
      "completed",
      "failed",
      "outcomeUnknown",
      "running",
      "waitingForApproval",
      "waitingForBudget",
      "waitingForContinue",
      "waitingForToolResults"
    ].includes(String(value.status))
  ) {
    return false;
  }
  try {
    const runtime = value.runtime as unknown as StoredRuntimeSession;
    const store = new InMemorySessionStore([runtime]);
    void store;
  } catch {
    return false;
  }
  return value.terminal === undefined || (
    _isRecord(value.terminal)
    && ["cancelled", "completed", "failed", "outcomeUnknown"]
      .includes(String(value.terminal.status))
  );
}

function _validRotationRecord(value: unknown): value is ServerRotationRecord {
  return _isRecord(value)
    && typeof value.expiresAt === "string"
    && Number.isFinite(Date.parse(value.expiresAt))
    && Number.isSafeInteger(value.generation)
    && (value.generation as number) >= 2
    && typeof value.idempotencyKey === "string"
    && value.idempotencyKey.length > 0
    && _isSha256(value.nextHash)
    && _isSha256(value.previousHash);
}

function _validEventMap(value: unknown, runs: readonly unknown[]): boolean {
  if (!_isRecord(value)) {
    return false;
  }
  const records = runs.filter(_validRunRecord);
  if (
    records.length !== runs.length
    || Object.keys(value).length !== records.length
  ) {
    return false;
  }
  return records.every(run => {
    const events = value[run.id];
    if (!Array.isArray(events)) {
      return false;
    }
    const valid = events.every((event, index) =>
      _isRecord(event)
      && event.sequence === index + 1
      && (
        (event.event === "pi" && _validPersistedPiEvent(event.data))
        || (event.event === "control" && (
          _validPersistedTerminal(event.data)
          || _validPersistedToolApprovalRequired(event.data)
          || _validPersistedSessionBudgetRequired(event.data)
        ))
      ));
    if (!valid) {
      return false;
    }
    const terminals = events.filter(event =>
      _isRecord(event)
      && event.event === "control"
      && _validPersistedTerminal(event.data));
    if (run.terminal === null) {
      return terminals.length === 0;
    }
    const terminal = terminals[0];
    return terminals.length === 1
      && events.at(-1) === terminal
      && _isRecord(terminal)
      && _validPersistedTerminal(terminal.data)
      && terminal.data.outcome === run.terminal;
  });
}

function _validTranscriptMessage(value: unknown): boolean {
  return _isRecord(value)
    && (value.role === "user"
      || value.role === "assistant"
      || value.role === "toolResult")
    && typeof value.timestamp === "number"
    && Number.isFinite(value.timestamp)
    && (
      typeof value.content === "string"
      || Array.isArray(value.content)
    );
}

function _validPersistedPiEvent(value: unknown): boolean {
  return _isRecord(value)
    && typeof value.type === "string"
    && [
      "agent_start",
      "agent_end",
      "turn_start",
      "turn_end",
      "message_start",
      "message_update",
      "message_end",
      "tool_execution_start",
      "tool_execution_update",
      "tool_execution_end"
    ].includes(value.type);
}

function _validPersistedTerminal(value: unknown): value is {
  readonly code?: string;
  readonly outcome: ServerRunTerminalOutcome;
  readonly runtime?: AgentServerRuntimeProjection;
  readonly structuredOutput?: RuntimeStructuredOutputResult;
  readonly type: "runTerminal";
} {
  return _isRecord(value)
    && value.type === "runTerminal"
    && (
      value.outcome === "cancelled"
      || value.outcome === "completed"
      || value.outcome === "failed"
      || value.outcome === "outcomeUnknown"
    )
    && (value.code === undefined || typeof value.code === "string")
    && (
      value.runtime === undefined
      || _validRuntimeProjection(value.runtime)
    )
    && (
      value.structuredOutput === undefined
      || _validStructuredOutput(value.structuredOutput)
    );
}

function _validRuntimeProjection(
  value: unknown
): value is AgentServerRuntimeProjection {
  if (
    !_isRecord(value)
    || typeof value.branchId !== "string"
    || value.branchId.length === 0
    || typeof value.checkpointId !== "string"
    || value.checkpointId.length === 0
    || !_isRecord(value.session)
    || (value.subagents !== undefined && (
      !Array.isArray(value.subagents)
      || !value.subagents.every(_validServerSubagentProjection)
    ))
  ) {
    return false;
  }
  let session: StoredRuntimeSession;
  try {
    session = value.session as unknown as StoredRuntimeSession;
    const validationStore = new InMemorySessionStore([session]);
    void validationStore;
  } catch {
    return false;
  }
  const checkpoint = session.snapshot.history.checkpoints.find(item =>
    item.id === value.checkpointId && item.branchId === value.branchId);
  const run = checkpoint
    ? session.snapshot.runs.find(item => item.id === checkpoint.runId)
    : undefined;
  return Boolean(
    checkpoint
    && run?.branchId === value.branchId
    && session.snapshot.history.currentBranchId === value.branchId
    && session.snapshot.history.currentCheckpointId === value.checkpointId
  );
}

function _validServerSubagentProjection(value: unknown): boolean {
  return _isRecord(value)
    && typeof value.artifactFingerprint === "string"
    && _isRecord(value.child)
    && typeof value.child.sessionId === "string"
    && typeof value.child.runId === "string"
    && typeof value.message === "string"
    && _isRecord(value.parent)
    && typeof value.parent.sessionId === "string"
    && typeof value.parent.runId === "string"
    && typeof value.parent.toolCallId === "string"
    && _isRecord(value.sandbox)
    && ["direct", "isolated", "shared"].includes(String(value.sandbox.mode))
    && typeof value.status === "string"
    && typeof value.subagentId === "string";
}

function _validPersistedToolApprovalRequired(value: unknown): boolean {
  return _isRecord(value)
    && value.type === "toolApprovalRequired"
    && Array.isArray(value.approvals)
    && value.approvals.length > 0
    && value.approvals.every(approval =>
      _isRecord(approval)
      && typeof approval.id === "string"
      && typeof approval.toolCallId === "string"
      && typeof approval.toolName === "string"
      && (approval.scope === "call" || approval.scope === "session")
      && (approval.reason === undefined || typeof approval.reason === "string"));
}

function _validPersistedSessionBudgetRequired(value: unknown): boolean {
  return _isRecord(value)
    && value.type === "sessionBudgetRequired"
    && isRuntimeSessionBudgetWaitSnapshot(value.budget)
    && value.budget.status === "waiting"
    && _isRecord(value.session)
    && _isRecord(value.session.snapshot)
    && typeof value.session.snapshot.id === "string";
}

function _assertTerminalAuthority(envelope: ServerSessionEnvelope): void {
  for (const run of envelope.runs) {
    if (run.terminal === null) { continue; }
    const terminal = envelope.events[run.id]?.at(-1);
    const runtimeRun = envelope.runtime?.snapshot.runs.find(
      candidate => candidate.id === run.id
    );
    const runtimeProjection = terminal?.event === "control"
      && _validPersistedTerminal(terminal.data)
      ? terminal.data.runtime
      : undefined;
    const projectedCheckpoint = runtimeProjection?.session.snapshot.history
      .checkpoints.find(candidate =>
        candidate.id === runtimeProjection.checkpointId
        && candidate.branchId === runtimeProjection.branchId);
    const projectedRun = projectedCheckpoint
      ? runtimeProjection?.session.snapshot.runs.find(
        candidate => candidate.id === projectedCheckpoint.runId
      )
      : undefined;
    if (
      terminal?.event !== "control"
      || !_validPersistedTerminal(terminal.data)
      || runtimeRun?.state !== terminal.data.outcome
      || !_sameStructuredOutput(
        terminal.data.structuredOutput,
        runtimeRun.structuredOutput
      )
      || (
        runtimeRun.failure?.code === "runLimitExceeded"
          ? terminal.data.code !== runtimeRun.failure.code
          : terminal.data.code === "runLimitExceeded"
      )
      || (
        runtimeProjection?.session.snapshot.id !== envelope.sessionId
        || projectedCheckpoint?.runId !== run.id
        || projectedCheckpoint?.state !== terminal.data.outcome
        || projectedRun?.id !== run.id
        || projectedRun?.state !== terminal.data.outcome
      )
    ) {
      throw new Error(
        `Server Run ${run.id} terminal does not match Runtime authority`
      );
    }
  }
}

function _sameStructuredOutput(
  left: RuntimeStructuredOutputResult | undefined,
  right: RuntimeStructuredOutputResult | undefined
): boolean {
  return left === undefined || right === undefined
    ? left === right
    : left.contract === right.contract
      && left.schemaFingerprint === right.schemaFingerprint
      && _canonicalJson(left.value) === _canonicalJson(right.value);
}

function _validStructuredOutput(
  value: unknown
): value is RuntimeStructuredOutputResult {
  return _isRecord(value)
    && typeof value.contract === "string"
    && value.contract.length > 0
    && typeof value.schemaFingerprint === "string"
    && /^[0-9a-f]{64}$/.test(value.schemaFingerprint)
    && _isJsonValue(value.value, new WeakSet());
}

function _isJsonValue(value: unknown, ancestors: WeakSet<object>): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return true;
  }
  if (typeof value === "number") { return Number.isFinite(value); }
  if (typeof value !== "object" || ancestors.has(value)) { return false; }
  const prototype = Object.getPrototypeOf(value) as object | null;
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    return false;
  }
  ancestors.add(value);
  const valid = (Array.isArray(value)
    ? value
    : Object.values(value as Record<string, unknown>))
    .every(child => _isJsonValue(child, ancestors));
  ancestors.delete(value);
  return valid;
}

function _canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") { return JSON.stringify(value); }
  if (Array.isArray(value)) {
    return `[${value.map(_canonicalJson).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map(key =>
    `${JSON.stringify(key)}:${_canonicalJson(record[key])}`)
    .join(",")}}`;
}

function _serverTerminalOutcome(
  state: RuntimeRunState
): ServerRunTerminalOutcome | null {
  return state === "cancelled"
    || state === "completed"
    || state === "failed"
    || state === "outcomeUnknown"
    ? state
    : null;
}

function _subagentStatus(
  session: StoredRuntimeSession,
  runId: string
): ServerSubagentRunRecord["status"] {
  const state = session.snapshot.runs.find(run => run.id === runId)?.state;
  if (!state) { throw new Error("Server Subagent Runtime Run disappeared"); }
  if (state === "runningModel" || state === "runningTools") { return "running"; }
  return state === "superseded" ? "cancelled" : state;
}

function _isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function _isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

async function _acquireOwnerLock(lockPath: string): Promise<FileHandle> {
  const handle = await open(lockPath, "a+", 0o600);
  await chmod(lockPath, 0o600);
  const libraryPath = process.platform === "darwin"
    ? "/usr/lib/libSystem.B.dylib"
    : process.platform === "linux"
      ? "libc.so.6"
      : null;
  if (!libraryPath) {
    await handle.close();
    throw new Error("Agent Server repository locking is unsupported here");
  }
  const library = dlopen(libraryPath, {
    flock: {
      args: [FFIType.i32, FFIType.i32],
      returns: FFIType.i32
    }
  });
  let result: number;
  try {
    result = library.symbols.flock(
      handle.fd,
      LOCK_EXCLUSIVE | LOCK_NONBLOCKING
    );
  } finally {
    library.close();
  }
  if (result !== 0) {
    await handle.close();
    throw new Error("Agent Server repository is already owned by another process");
  }
  return handle;
}

function _hasCode(error: unknown, code: string): boolean {
  return Boolean(
    error
    && typeof error === "object"
    && "code" in error
    && error.code === code
  );
}

function _createdSession(
  envelope: ServerSessionEnvelope,
  expiresAt: string
): CreatedServerSession {
  return {
    schemaVersion: SERVER_SESSION_SCHEMA_VERSION,
    sessionId: envelope.sessionId,
    continuation: {
      generation: 1,
      expiresAt
    }
  };
}

function _rotatedContinuation(
  envelope: ServerSessionEnvelope,
  rotation: ServerRotationRecord
): RotatedServerContinuation {
  return {
    schemaVersion: SERVER_SESSION_SCHEMA_VERSION,
    sessionId: envelope.sessionId,
    continuation: {
      generation: rotation.generation,
      expiresAt: rotation.expiresAt
    }
  };
}

function _assertContinuationToken(token: string): void {
  const bytes = Buffer.from(token, "base64url");
  if (
    token.length > 1_024
    || !/^[A-Za-z0-9_-]+$/.test(token)
    || bytes.toString("base64url") !== token
    || bytes.byteLength < 32
  ) {
    throw new TypeError("Continuation tokens must contain at least 32 bytes");
  }
}

function _samePrincipal(
  left: ServerPrincipal,
  right: ServerPrincipal
): boolean {
  return left.issuer === right.issuer
    && left.principalId === right.principalId;
}

function _sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function _runInputHash(
  text: string,
  outputContract?: string,
  workingBase?: RuntimeWorkingBase
): string {
  return _sha256(JSON.stringify({
    text,
    outputContract: outputContract ?? null,
    workingBase: workingBase ?? null
  }));
}

function _transcriptAtWorkingBase(
  session: ServerSessionEnvelope,
  workingBase?: RuntimeWorkingBase
): readonly AgentMessage[] {
  if (!workingBase) { return session.transcript; }
  const history = session.runtime?.snapshot.history;
  const checkpoint = history?.checkpoints.find(item =>
    item.id === workingBase.checkpointId
    && item.branchId === workingBase.branchId);
  if (!history || !checkpoint) {
    throw new TypeError("Runtime working base is unavailable");
  }
  return runtimeHistoryMessages(
    history,
    checkpoint.headEntryId
  ) as unknown as readonly AgentMessage[];
}

function _terminalRuntimeProjection(
  session: StoredRuntimeSession,
  run: StoredRuntimeSession["snapshot"]["runs"][number],
  subagents: readonly ServerSubagentRunRecord[]
): AgentServerRuntimeProjection | null {
  const checkpoint = session.snapshot.history.checkpoints
    .filter(item => item.runId === run.id && item.state === run.state)
    .at(-1);
  if (!checkpoint) { return null; }
  return {
    branchId: checkpoint.branchId,
    checkpointId: checkpoint.id,
    session,
    ...(subagents.some(child => child.parent.runId === run.id)
      ? {
        subagents: subagents
          .filter(child => child.parent.runId === run.id)
          .map(child => ({
            artifactFingerprint: child.artifactFingerprint,
            child: child.child,
            message: child.message,
            parent: child.parent,
            sandbox: child.sandbox,
            status: child.status,
            subagentId: child.subagentId,
            ...(child.terminal ? { terminal: child.terminal } : {})
          }))
      }
      : {})
  };
}

function _equalHash(left: string, right: string): boolean {
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function _recoverableTranscript(
  session: ServerSessionEnvelope,
  runId: string
): readonly AgentMessage[] {
  const runtimeRun = session.runtime?.snapshot.runs.find(run => run.id === runId);
  if (runtimeRun?.state === "waitingForToolResults") {
    return session.transcript;
  }
  const activeStep = session.runtime?.snapshot.operationLedger?.steps.find(
    step => step.runId === runId && step.state === "active"
  );
  if (!activeStep) {
    return session.transcript;
  }
  if (activeStep.operations.some(operation => operation.state === "parked")) {
    return session.transcript;
  }
  if (activeStep.transcriptMessageCount > session.transcript.length) {
    throw new Error(
      `Server Session transcript is shorter than durable Step ${activeStep.id}`
    );
  }
  return session.transcript.slice(0, activeStep.transcriptMessageCount);
}

function _snapshot<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function _persistedEventWireByteLength(event: PersistedServerEvent): number {
  return new TextEncoder().encode(
    `id: ${event.sequence}\nevent: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`
  ).byteLength;
}
