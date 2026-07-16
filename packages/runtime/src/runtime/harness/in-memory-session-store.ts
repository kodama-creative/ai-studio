import {
  isTerminalRuntimeRunState,
  type RuntimeRunSnapshot,
  transitionRuntimeRun
} from "./runtime-run";
import {
  RUNTIME_SESSION_SCHEMA_VERSION,
  type RuntimeRunConfigurationSnapshot,
  type RuntimeRunJournalEntry,
  type RuntimeSessionMutation,
  type RuntimeSessionSnapshot,
  type SessionStore,
  type SessionStoreCommit,
  SessionStoreConflictError,
  SessionStoreInvariantError,
  type StoredRuntimeSession
} from "./session-store";

export class InMemorySessionStore implements SessionStore {
  private readonly _sessions = new Map<string, StoredRuntimeSession>();

  async load(sessionId: string): Promise<StoredRuntimeSession | null> {
    _assertId("Session", sessionId);
    const stored = this._sessions.get(sessionId);
    return Promise.resolve(stored ? _snapshot(stored) : null);
  }

  async commit(input: SessionStoreCommit): Promise<StoredRuntimeSession> {
    _assertId("Session", input.sessionId);
    _assertExpectedVersion(input.expectedVersion);
    if (input.mutations.length === 0) {
      throw new SessionStoreInvariantError(
        "A Session Store commit requires at least one mutation"
      );
    }

    const current = this._sessions.get(input.sessionId);
    const actualVersion = current?.version ?? null;
    if (input.expectedVersion !== actualVersion) {
      throw new SessionStoreConflictError(
        input.sessionId,
        input.expectedVersion,
        actualVersion
      );
    }

    const nextVersion = (current?.version ?? 0) + 1;
    const snapshot: RuntimeSessionSnapshot = current
      ? structuredClone(current.snapshot)
      : {
        schemaVersion: RUNTIME_SESSION_SCHEMA_VERSION,
        id: input.sessionId,
        activeRunId: null,
        runs: []
      };
    const configurations = new Map(
      (current?.configurations ?? []).map(configuration => [
        configuration.id,
        structuredClone(configuration)
      ])
    );
    const journal: RuntimeRunJournalEntry[] = structuredClone([
      ...(current?.journal ?? [])
    ]);

    for (const mutation of input.mutations) {
      _applyMutation({
        configurationById: configurations,
        journal,
        mutation,
        sessionVersion: nextVersion,
        snapshot
      });
    }

    const stored = _snapshot({
      version: nextVersion,
      snapshot,
      configurations: [...configurations.values()],
      journal
    });
    this._sessions.set(input.sessionId, stored);
    return Promise.resolve(_snapshot(stored));
  }
}

function _applyMutation({
  configurationById,
  journal,
  mutation,
  sessionVersion,
  snapshot
}: {
  configurationById: Map<string, RuntimeRunConfigurationSnapshot>;
  journal: RuntimeRunJournalEntry[];
  mutation: RuntimeSessionMutation;
  sessionVersion: number;
  snapshot: RuntimeSessionSnapshot;
}): void {
  if (mutation.type === "startRun") {
    _startRun({
      configurationById,
      journal,
      mutation,
      sessionVersion,
      snapshot
    });
    return;
  }
  _transitionRun({ journal, mutation, sessionVersion, snapshot });
}

function _startRun({
  configurationById,
  journal,
  mutation,
  sessionVersion,
  snapshot
}: {
  configurationById: Map<string, RuntimeRunConfigurationSnapshot>;
  journal: RuntimeRunJournalEntry[];
  mutation: Extract<RuntimeSessionMutation, { type: "startRun"; }>;
  sessionVersion: number;
  snapshot: RuntimeSessionSnapshot;
}): void {
  _assertId("Runtime Run", mutation.runId);
  _assertConfiguration(mutation.configuration);
  if (snapshot.activeRunId !== null) {
    throw new SessionStoreInvariantError(
      `Session ${snapshot.id} already has active Runtime Run ${snapshot.activeRunId}`
    );
  }
  if (snapshot.runs.some(run => run.id === mutation.runId)) {
    throw new SessionStoreInvariantError(
      `Runtime Run ${mutation.runId} already exists in Session ${snapshot.id}`
    );
  }
  const existingConfiguration = configurationById.get(
    mutation.configuration.id
  );
  if (
    existingConfiguration
    && !_sameConfiguration(existingConfiguration, mutation.configuration)
  ) {
    throw new SessionStoreInvariantError(
      `Run Configuration Snapshot ${mutation.configuration.id} is immutable`
    );
  }
  if (!existingConfiguration) {
    configurationById.set(
      mutation.configuration.id,
      structuredClone(mutation.configuration)
    );
  }

  const run: RuntimeRunSnapshot = {
    id: mutation.runId,
    sessionId: snapshot.id,
    configurationId: mutation.configuration.id,
    state: "runningModel"
  };
  (snapshot.runs as RuntimeRunSnapshot[]).push(run);
  (snapshot as { activeRunId: string | null; }).activeRunId = run.id;
  journal.push({
    type: "runStarted",
    sequence: journal.length + 1,
    sessionVersion,
    runId: run.id,
    configurationId: run.configurationId,
    state: "runningModel"
  });
}

function _transitionRun({
  journal,
  mutation,
  sessionVersion,
  snapshot
}: {
  journal: RuntimeRunJournalEntry[];
  mutation: Extract<RuntimeSessionMutation, { type: "transitionRun"; }>;
  sessionVersion: number;
  snapshot: RuntimeSessionSnapshot;
}): void {
  _assertId("Runtime Run", mutation.runId);
  const runIndex = snapshot.runs.findIndex(run => run.id === mutation.runId);
  const run = snapshot.runs[runIndex];
  if (!run) {
    throw new SessionStoreInvariantError(
      `Runtime Run ${mutation.runId} does not exist in Session ${snapshot.id}`
    );
  }
  if (snapshot.activeRunId !== run.id) {
    throw new SessionStoreInvariantError(
      `Runtime Run ${run.id} is not active in Session ${snapshot.id}`
    );
  }
  const next = transitionRuntimeRun(run, mutation.to);
  (snapshot.runs as RuntimeRunSnapshot[])[runIndex] = next;
  if (isTerminalRuntimeRunState(next.state)) {
    (snapshot as { activeRunId: string | null; }).activeRunId = null;
  }
  journal.push({
    type: "runStateChanged",
    sequence: journal.length + 1,
    sessionVersion,
    runId: run.id,
    from: run.state,
    to: next.state
  });
}

function _assertConfiguration(
  configuration: RuntimeRunConfigurationSnapshot
): void {
  _assertId("Run Configuration Snapshot", configuration.id);
  _assertId("Agent snapshot fingerprint", configuration.agentSnapshotFingerprint);
  _assertId("Context fingerprint", configuration.contextFingerprint);
  _assertId("Model provider", configuration.model.provider);
  _assertId("Model id", configuration.model.id);
  _assertId(
    "Tool configuration fingerprint",
    configuration.toolConfigurationFingerprint
  );
}

function _assertExpectedVersion(version: number | null): void {
  if (
    version !== null
    && (!Number.isSafeInteger(version) || version < 1)
  ) {
    throw new SessionStoreInvariantError(
      "Expected Session version must be null or a positive safe integer"
    );
  }
}

function _assertId(label: string, value: string): void {
  if (value.trim().length === 0) {
    throw new SessionStoreInvariantError(`${label} must not be empty`);
  }
}

function _sameConfiguration(
  left: RuntimeRunConfigurationSnapshot,
  right: RuntimeRunConfigurationSnapshot
): boolean {
  return (
    left.id === right.id
    && left.agentSnapshotFingerprint === right.agentSnapshotFingerprint
    && left.contextFingerprint === right.contextFingerprint
    && left.executionMode === right.executionMode
    && left.model.provider === right.model.provider
    && left.model.id === right.model.id
    && left.reasoning === right.reasoning
    && left.toolConfigurationFingerprint === right.toolConfigurationFingerprint
  );
}

function _snapshot<T>(value: T): T {
  return _deepFreeze(structuredClone(value));
}

function _deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      _deepFreeze(child);
    }
  }
  return value;
}
