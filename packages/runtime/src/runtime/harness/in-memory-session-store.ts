import { deriveCapabilitySnapshotFingerprint } from "./derive-capability-snapshot-fingerprint";
import { deriveInstructionSnapshotContent } from "./derive-instruction-snapshot-content";
import { immutableSnapshot } from "./immutable-snapshot";
import {
  isTerminalRuntimeRunState,
  RUNTIME_RUN_STATES,
  type RuntimeRunSnapshot,
  type RuntimeRunState,
  transitionRuntimeRun
} from "./runtime-run";
import {
  MAX_SESSION_STATE_BYTES,
  MAX_SESSION_STATE_SLOT_BYTES,
  MAX_SESSION_STATE_SLOTS,
  RUNTIME_SESSION_SCHEMA_VERSION,
  RUNTIME_SESSION_STATE_SCHEMA_VERSION,
  type RuntimeRunConfigurationSnapshot,
  type RuntimeRunJournalEntry,
  type RuntimeSessionMutation,
  type RuntimeSessionSnapshot,
  type RuntimeSessionStateEntry,
  type SessionStore,
  type SessionStoreCommit,
  SessionStoreConflictError,
  SessionStoreInvariantError,
  type StoredRuntimeSession
} from "./session-store";

const CHECKPOINT_STATES = new Set([
  "waitingForToolResults",
  "waitingForContinue",
  "completed",
  "failed",
  "cancelled",
  "superseded",
  "outcomeUnknown"
]);
const RUN_STATES = new Set<string>(RUNTIME_RUN_STATES);

export class InMemorySessionStore implements SessionStore {
  private readonly _sessions = new Map<string, StoredRuntimeSession>();

  constructor(initialSessions: readonly StoredRuntimeSession[] = []) {
    for (const session of initialSessions) {
      _assertStoredSession(session);
      if (this._sessions.has(session.snapshot.id)) {
        throw new SessionStoreInvariantError(
          `Session ${session.snapshot.id} was hydrated more than once`
        );
      }
      this._sessions.set(session.snapshot.id, immutableSnapshot(session));
    }
  }

  async load(sessionId: string): Promise<StoredRuntimeSession | null> {
    _assertId("Session", sessionId);
    const stored = this._sessions.get(sessionId);
    if (stored) {
      await _assertInstructionSnapshotIntegrity(stored.snapshot);
      await _assertCapabilitySnapshotIntegrity(stored.snapshot);
    }
    return Promise.resolve(stored ? immutableSnapshot(stored) : null);
  }

  async commit(input: SessionStoreCommit): Promise<StoredRuntimeSession> {
    _assertId("Session", input.sessionId);
    _assertExpectedVersion(input.expectedVersion);
    if (input.mutations.length === 0) {
      throw new SessionStoreInvariantError(
        "A Session Store commit requires at least one mutation"
      );
    }
    for (const mutation of input.mutations) {
      if (mutation.type === "recordTurnInstructions") {
        await _assertInstructionSnapshotIntegrity({
          instructionSnapshots: { [mutation.snapshot.turnId]: mutation.snapshot }
        });
      }
      if (mutation.type === "recordTurnCapabilities") {
        await _assertCapabilitySnapshotIntegrity({
          capabilitySnapshots: {
            [mutation.snapshot.turnId]: mutation.snapshot
          }
        });
      }
    }

    let current = this._sessions.get(input.sessionId);
    if (current) {
      await _assertInstructionSnapshotIntegrity(current.snapshot);
      await _assertCapabilitySnapshotIntegrity(current.snapshot);
      current = this._sessions.get(input.sessionId);
    }
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

    const stored = immutableSnapshot({
      version: nextVersion,
      snapshot,
      configurations: [...configurations.values()],
      journal
    });
    this._sessions.set(input.sessionId, stored);
    return Promise.resolve(immutableSnapshot(stored));
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
  if (mutation.type === "transitionRun") {
    _transitionRun({ journal, mutation, sessionVersion, snapshot });
    return;
  }
  if (mutation.type === "replaceState") {
    _replaceState({ journal, mutation, sessionVersion, snapshot });
    return;
  }
  if (mutation.type === "recordTurnInstructions") {
    _recordTurnInstructions({ journal, mutation, sessionVersion, snapshot });
    return;
  }
  if (mutation.type === "recordTurnCapabilities") {
    _recordTurnCapabilities({ journal, mutation, sessionVersion, snapshot });
    return;
  }
  _recordCheckpoint({ journal, mutation, sessionVersion, snapshot });
}

function _recordTurnCapabilities({
  journal,
  mutation,
  sessionVersion,
  snapshot
}: {
  journal: RuntimeRunJournalEntry[];
  mutation: Extract<RuntimeSessionMutation, { type: "recordTurnCapabilities"; }>;
  sessionVersion: number;
  snapshot: RuntimeSessionSnapshot;
}): void {
  _assertCapabilitySnapshot(mutation.snapshot);
  const existing = snapshot.capabilitySnapshots?.[mutation.snapshot.turnId];
  if (existing) {
    throw new SessionStoreInvariantError(
      `Turn capability snapshot ${mutation.snapshot.turnId} is immutable`
    );
  }
  (snapshot as {
    capabilitySnapshots?: RuntimeSessionSnapshot["capabilitySnapshots"];
  }).capabilitySnapshots = {
    ...snapshot.capabilitySnapshots,
    [mutation.snapshot.turnId]: structuredClone(mutation.snapshot)
  };
  journal.push({
    type: "turnCapabilitiesRecorded",
    sequence: journal.length + 1,
    sessionVersion,
    turnId: mutation.snapshot.turnId,
    fingerprint: mutation.snapshot.fingerprint
  });
}

function _recordTurnInstructions({
  journal,
  mutation,
  sessionVersion,
  snapshot
}: {
  journal: RuntimeRunJournalEntry[];
  mutation: Extract<RuntimeSessionMutation, { type: "recordTurnInstructions"; }>;
  sessionVersion: number;
  snapshot: RuntimeSessionSnapshot;
}): void {
  _assertInstructionSnapshot(mutation.snapshot);
  const existing = snapshot.instructionSnapshots?.[mutation.snapshot.turnId];
  if (existing) {
    throw new SessionStoreInvariantError(
      `Turn instruction snapshot ${mutation.snapshot.turnId} is immutable`
    );
  }
  (snapshot as {
    instructionSnapshots?: RuntimeSessionSnapshot["instructionSnapshots"];
  }).instructionSnapshots = {
    ...snapshot.instructionSnapshots,
    [mutation.snapshot.turnId]: structuredClone(mutation.snapshot)
  };
  journal.push({
    type: "turnInstructionsRecorded",
    sequence: journal.length + 1,
    sessionVersion,
    turnId: mutation.snapshot.turnId,
    fingerprint: mutation.snapshot.fingerprint
  });
}

function _replaceState({
  journal,
  mutation,
  sessionVersion,
  snapshot
}: {
  journal: RuntimeRunJournalEntry[];
  mutation: Extract<RuntimeSessionMutation, { type: "replaceState"; }>;
  sessionVersion: number;
  snapshot: RuntimeSessionSnapshot;
}): void {
  assertRuntimeSessionStateValues(mutation.values);
  const revision = (snapshot.state?.revision ?? 0) + 1;
  (snapshot as { state?: RuntimeSessionSnapshot["state"]; }).state = {
    schemaVersion: RUNTIME_SESSION_STATE_SCHEMA_VERSION,
    revision,
    values: structuredClone(mutation.values)
  };
  journal.push({
    type: "sessionStateReplaced",
    sequence: journal.length + 1,
    sessionVersion,
    revision,
    names: Object.keys(mutation.values).sort()
  });
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

function _recordCheckpoint({
  journal,
  mutation,
  sessionVersion,
  snapshot
}: {
  journal: RuntimeRunJournalEntry[];
  mutation: Extract<RuntimeSessionMutation, { type: "recordCheckpoint"; }>;
  sessionVersion: number;
  snapshot: RuntimeSessionSnapshot;
}): void {
  _assertId("Runtime Run", mutation.runId);
  _assertId("Continuation fingerprint", mutation.continuationFingerprint);
  const runIndex = snapshot.runs.findIndex(run => run.id === mutation.runId);
  const run = snapshot.runs[runIndex];
  if (!run) {
    throw new SessionStoreInvariantError(
      `Runtime Run ${mutation.runId} does not exist in Session ${snapshot.id}`
    );
  }
  if (run.state === "runningModel" || run.state === "runningTools") {
    throw new SessionStoreInvariantError(
      `Runtime Run ${run.id} cannot record a checkpoint while ${run.state}`
    );
  }
  if (run.checkpoint?.state === run.state) {
    throw new SessionStoreInvariantError(
      `Runtime Run ${run.id} already recorded its ${run.state} checkpoint`
    );
  }
  const checkpoint = {
    order: (run.checkpoint?.order ?? 0) + 1,
    state: run.state,
    continuationFingerprint: mutation.continuationFingerprint
  };
  (snapshot.runs as RuntimeRunSnapshot[])[runIndex] = {
    ...run,
    checkpoint
  };
  journal.push({
    type: "runCheckpointRecorded",
    sequence: journal.length + 1,
    sessionVersion,
    runId: run.id,
    ...checkpoint
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

function _assertInstructionSnapshot(
  snapshot: NonNullable<RuntimeSessionSnapshot["instructionSnapshots"]>[string]
): void {
  _assertId("Instruction Turn", snapshot.turnId);
  _assertId("Agent snapshot fingerprint", snapshot.agentSnapshotFingerprint);
  if (!/^[0-9a-f]{64}$/.test(snapshot.fingerprint)) {
    throw new SessionStoreInvariantError(
      `Turn ${snapshot.turnId} has an invalid instruction fingerprint`
    );
  }
  if (typeof snapshot.markdown !== "string") {
    throw new SessionStoreInvariantError(
      `Turn ${snapshot.turnId} has invalid instruction Markdown`
    );
  }
  for (const entry of snapshot.entries) {
    if (
      (entry.kind !== "static" && entry.kind !== "dynamic")
      || entry.sourcePath.trim().length === 0
      || typeof entry.markdown !== "string"
    ) {
      throw new SessionStoreInvariantError(
        `Turn ${snapshot.turnId} has an invalid instruction entry`
      );
    }
  }
}

async function _assertInstructionSnapshotIntegrity(
  snapshot: Pick<RuntimeSessionSnapshot, "instructionSnapshots">
): Promise<void> {
  for (const instructionSnapshot of Object.values(
    snapshot.instructionSnapshots ?? {}
  )) {
    _assertInstructionSnapshot(instructionSnapshot);
    const { fingerprint, markdown } = await deriveInstructionSnapshotContent(
      instructionSnapshot.entries
    );
    if (instructionSnapshot.markdown !== markdown) {
      throw new SessionStoreInvariantError(
        `Turn ${instructionSnapshot.turnId} instruction Markdown does not match its entries`
      );
    }
    if (instructionSnapshot.fingerprint !== fingerprint) {
      throw new SessionStoreInvariantError(
        `Turn ${instructionSnapshot.turnId} instruction fingerprint does not match its entries`
      );
    }
  }
}

function _assertCapabilitySnapshot(
  snapshot: NonNullable<RuntimeSessionSnapshot["capabilitySnapshots"]>[string]
): void {
  _assertId("Capability Turn", snapshot.turnId);
  _assertId("Agent snapshot fingerprint", snapshot.agentSnapshotFingerprint);
  _assertId("Host policy fingerprint", snapshot.hostPolicyFingerprint);
  _assertId("Capability request fingerprint", snapshot.requestFingerprint);
  _assertId("Capability model provider", snapshot.model.provider);
  _assertId("Capability model id", snapshot.model.id);
  _assertCapabilityModelOptions(snapshot);
  if (
    snapshot.reasoning !== undefined
    && !["off", "minimal", "low", "medium", "high", "xhigh"].includes(
      snapshot.reasoning
    )
  ) {
    throw new SessionStoreInvariantError(
      `Turn ${snapshot.turnId} has invalid capability reasoning`
    );
  }
  if (!/^[0-9a-f]{64}$/.test(snapshot.fingerprint)) {
    throw new SessionStoreInvariantError(
      `Turn ${snapshot.turnId} has an invalid capability fingerprint`
    );
  }
  for (const tool of snapshot.connectionTools) {
    if (
      typeof tool.connectionName !== "string"
      || typeof tool.contributionId !== "string"
      || typeof tool.schemaFingerprint !== "string"
      || typeof tool.toolName !== "string"
    ) {
      throw new SessionStoreInvariantError(
        `Turn ${snapshot.turnId} has invalid connection-tool provenance`
      );
    }
    _assertId("Capability connection", tool.connectionName);
    _assertId("Capability connection contribution", tool.contributionId);
    _assertId("Capability connection schema", tool.schemaFingerprint);
    _assertId("Capability connection tool", tool.toolName);
  }
  for (const tool of snapshot.tools) {
    if (
      typeof tool.name !== "string"
      || typeof tool.contributionId !== "string"
      || typeof tool.description !== "string"
      || typeof tool.schemaFingerprint !== "string"
    ) {
      throw new SessionStoreInvariantError(
        `Turn ${snapshot.turnId} has an invalid capability tool`
      );
    }
    _assertId("Capability tool name", tool.name);
    _assertId("Capability contribution", tool.contributionId);
    _assertId("Capability schema fingerprint", tool.schemaFingerprint);
    _assertJsonStateValue(tool.inputSchema, tool.name, new WeakSet());
    if (tool.outputSchema !== undefined) {
      _assertJsonStateValue(tool.outputSchema, tool.name, new WeakSet());
    }
    if (tool.stepId !== undefined || tool.closureVariables !== undefined) {
      _assertId("Dynamic tool step", tool.stepId ?? "");
      if (tool.closureVariables === undefined) {
        throw new SessionStoreInvariantError(
          `Dynamic tool ${tool.name} is missing closure variables`
        );
      }
      _assertJsonStateValue(
        tool.closureVariables,
        `${tool.name} closure`,
        new WeakSet()
      );
    }
  }
}

function _assertCapabilityModelOptions(
  snapshot: NonNullable<RuntimeSessionSnapshot["capabilitySnapshots"]>[string]
): void {
  const options = snapshot.modelOptions;
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new SessionStoreInvariantError(
      `Turn ${snapshot.turnId} has invalid capability model options`
    );
  }
  const numberKeys = new Set([
    "maxRetries",
    "maxRetryDelayMs",
    "maxTokens",
    "temperature",
    "timeoutMs",
    "websocketConnectTimeoutMs"
  ]);
  const allowedKeys = new Set([
    ...numberKeys,
    "cacheRetention",
    "thinkingBudgets",
    "transport"
  ]);
  for (const [key, value] of Object.entries(options)) {
    if (!allowedKeys.has(key)) {
      throw new SessionStoreInvariantError(
        `Turn ${snapshot.turnId} has forbidden capability model option ${key}`
      );
    }
    if (numberKeys.has(key) && (typeof value !== "number" || !Number.isFinite(value))) {
      throw new SessionStoreInvariantError(
        `Turn ${snapshot.turnId} has invalid capability model option ${key}`
      );
    }
  }
  if (
    options.cacheRetention !== undefined
    && !["none", "short", "long"].includes(options.cacheRetention)
  ) {
    throw new SessionStoreInvariantError(
      `Turn ${snapshot.turnId} has invalid capability cache retention`
    );
  }
  if (
    options.transport !== undefined
    && !["auto", "sse", "websocket", "websocket-cached"].includes(
      options.transport
    )
  ) {
    throw new SessionStoreInvariantError(
      `Turn ${snapshot.turnId} has invalid capability transport`
    );
  }
  if (options.thinkingBudgets !== undefined) {
    const budgets = options.thinkingBudgets;
    if (!budgets || typeof budgets !== "object" || Array.isArray(budgets)) {
      throw new SessionStoreInvariantError(
        `Turn ${snapshot.turnId} has invalid capability thinking budgets`
      );
    }
    for (const [key, value] of Object.entries(budgets)) {
      if (
        !["minimal", "low", "medium", "high"].includes(key)
        || typeof value !== "number"
        || !Number.isFinite(value)
      ) {
        throw new SessionStoreInvariantError(
          `Turn ${snapshot.turnId} has invalid capability thinking budget ${key}`
        );
      }
    }
  }
}

async function _assertCapabilitySnapshotIntegrity(
  snapshot: Pick<RuntimeSessionSnapshot, "capabilitySnapshots">
): Promise<void> {
  for (const capabilitySnapshot of Object.values(
    snapshot.capabilitySnapshots ?? {}
  )) {
    _assertCapabilitySnapshot(capabilitySnapshot);
    const { fingerprint: _fingerprint, ...content } = capabilitySnapshot;
    if (
      capabilitySnapshot.fingerprint
      !== await deriveCapabilitySnapshotFingerprint(content)
    ) {
      throw new SessionStoreInvariantError(
        `Turn ${capabilitySnapshot.turnId} capability fingerprint does not match its content`
      );
    }
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

function _assertStoredSession(session: StoredRuntimeSession): void {
  if (!Number.isSafeInteger(session.version) || session.version < 1) {
    throw new SessionStoreInvariantError(
      "Stored Session version must be a positive safe integer"
    );
  }
  if (session.snapshot.schemaVersion !== RUNTIME_SESSION_SCHEMA_VERSION) {
    throw new SessionStoreInvariantError(
      `Unsupported Runtime Session schema version: ${String(session.snapshot.schemaVersion)}`
    );
  }
  _assertId("Session", session.snapshot.id);
  if (session.snapshot.state) {
    if (
      session.snapshot.state.schemaVersion
      !== RUNTIME_SESSION_STATE_SCHEMA_VERSION
      || !Number.isSafeInteger(session.snapshot.state.revision)
      || session.snapshot.state.revision < 1
    ) {
      throw new SessionStoreInvariantError(
        `Session ${session.snapshot.id} has invalid structured state metadata`
      );
    }
    assertRuntimeSessionStateValues(session.snapshot.state.values);
  }
  for (const [turnId, snapshot] of Object.entries(
    session.snapshot.instructionSnapshots ?? {}
  )) {
    _assertInstructionSnapshot(snapshot);
    if (snapshot.turnId !== turnId) {
      throw new SessionStoreInvariantError(
        `Turn instruction snapshot key ${turnId} does not match ${snapshot.turnId}`
      );
    }
  }
  for (const [turnId, snapshot] of Object.entries(
    session.snapshot.capabilitySnapshots ?? {}
  )) {
    _assertCapabilitySnapshot(snapshot);
    if (snapshot.turnId !== turnId) {
      throw new SessionStoreInvariantError(
        `Turn capability snapshot key ${turnId} does not match ${snapshot.turnId}`
      );
    }
  }

  const configurations = new Map<string, RuntimeRunConfigurationSnapshot>();
  for (const configuration of session.configurations) {
    _assertConfiguration(configuration);
    if (configurations.has(configuration.id)) {
      throw new SessionStoreInvariantError(
        `Run Configuration Snapshot ${configuration.id} is duplicated`
      );
    }
    configurations.set(configuration.id, configuration);
  }

  const runIds = new Set<string>();
  let activeRunCount = 0;
  for (const run of session.snapshot.runs) {
    _assertId("Runtime Run", run.id);
    if (!RUN_STATES.has(run.state)) {
      throw new SessionStoreInvariantError(
        `Runtime Run ${run.id} has invalid state ${run.state}`
      );
    }
    if (run.sessionId !== session.snapshot.id) {
      throw new SessionStoreInvariantError(
        `Runtime Run ${run.id} belongs to Session ${run.sessionId}, not ${session.snapshot.id}`
      );
    }
    if (runIds.has(run.id)) {
      throw new SessionStoreInvariantError(
        `Runtime Run ${run.id} is duplicated in Session ${session.snapshot.id}`
      );
    }
    if (!configurations.has(run.configurationId)) {
      throw new SessionStoreInvariantError(
        `Runtime Run ${run.id} references missing configuration ${run.configurationId}`
      );
    }
    runIds.add(run.id);
    if (run.checkpoint) {
      _assertId(
        "Continuation fingerprint",
        run.checkpoint.continuationFingerprint
      );
      if (
        !Number.isSafeInteger(run.checkpoint.order)
        || run.checkpoint.order < 1
        || !CHECKPOINT_STATES.has(run.checkpoint.state)
      ) {
        throw new SessionStoreInvariantError(
          `Runtime Run ${run.id} has an invalid checkpoint`
        );
      }
    }
    if (!isTerminalRuntimeRunState(run.state)) {
      activeRunCount += 1;
      if (session.snapshot.activeRunId !== run.id) {
        throw new SessionStoreInvariantError(
          `Non-terminal Runtime Run ${run.id} must be the active Run`
        );
      }
    }
  }
  if (activeRunCount > 1) {
    throw new SessionStoreInvariantError(
      `Session ${session.snapshot.id} has more than one active Runtime Run`
    );
  }
  if (
    session.snapshot.activeRunId !== null
    && !runIds.has(session.snapshot.activeRunId)
  ) {
    throw new SessionStoreInvariantError(
      `Session ${session.snapshot.id} references missing active Runtime Run ${session.snapshot.activeRunId}`
    );
  }
  if (
    (session.snapshot.activeRunId === null && activeRunCount !== 0)
    || (session.snapshot.activeRunId !== null && activeRunCount !== 1)
  ) {
    throw new SessionStoreInvariantError(
      `Session ${session.snapshot.id} active Runtime Run invariant is invalid`
    );
  }

  let previousSessionVersion = 0;
  let stateRevision = 0;
  const instructionTurns = new Set<string>();
  const capabilityTurns = new Set<string>();
  for (const [index, entry] of session.journal.entries()) {
    if (entry.sequence !== index + 1) {
      throw new SessionStoreInvariantError(
        `Run Journal sequence must be contiguous at ${index + 1}`
      );
    }
    if (
      !Number.isSafeInteger(entry.sessionVersion)
      || entry.sessionVersion < 1
      || entry.sessionVersion > session.version
    ) {
      throw new SessionStoreInvariantError(
        `Run Journal entry ${entry.sequence} has an invalid Session version`
      );
    }
    if (
      entry.sessionVersion < previousSessionVersion
      || entry.sessionVersion > previousSessionVersion + 1
    ) {
      throw new SessionStoreInvariantError(
        `Run Journal entry ${entry.sequence} has non-contiguous Session version ${entry.sessionVersion}`
      );
    }
    previousSessionVersion = entry.sessionVersion;
    if (entry.type === "sessionStateReplaced") {
      stateRevision += 1;
      if (
        entry.revision !== stateRevision
        || entry.names.some((name, nameIndex) => {
          const previousName = entry.names[nameIndex - 1];
          return name.trim().length === 0
            || (nameIndex > 0
              && previousName !== undefined
              && previousName >= name);
        })
      ) {
        throw new SessionStoreInvariantError(
          `Session state journal entry ${entry.sequence} is invalid`
        );
      }
      continue;
    }
    if (entry.type === "turnInstructionsRecorded") {
      if (
        instructionTurns.has(entry.turnId)
        || session.snapshot.instructionSnapshots?.[entry.turnId]?.fingerprint
        !== entry.fingerprint
      ) {
        throw new SessionStoreInvariantError(
          `Turn instruction journal entry ${entry.sequence} is invalid`
        );
      }
      instructionTurns.add(entry.turnId);
      continue;
    }
    if (entry.type === "turnCapabilitiesRecorded") {
      if (
        capabilityTurns.has(entry.turnId)
        || session.snapshot.capabilitySnapshots?.[entry.turnId]?.fingerprint
        !== entry.fingerprint
      ) {
        throw new SessionStoreInvariantError(
          `Turn capability journal entry ${entry.sequence} is invalid`
        );
      }
      capabilityTurns.add(entry.turnId);
      continue;
    }
    if (!runIds.has(entry.runId)) {
      throw new SessionStoreInvariantError(
        `Run Journal entry ${entry.sequence} references missing Runtime Run ${entry.runId}`
      );
    }
    if (
      entry.type === "runStarted"
      && !configurations.has(entry.configurationId)
    ) {
      throw new SessionStoreInvariantError(
        `Run Journal entry ${entry.sequence} references missing configuration ${entry.configurationId}`
      );
    }
  }
  if (previousSessionVersion !== session.version) {
    throw new SessionStoreInvariantError(
      `Run Journal ends at Session version ${previousSessionVersion}, expected ${session.version}`
    );
  }
  if (stateRevision !== (session.snapshot.state?.revision ?? 0)) {
    throw new SessionStoreInvariantError(
      `Session state journal revision ${stateRevision} does not match snapshot revision ${String(session.snapshot.state?.revision ?? 0)}`
    );
  }
  if (
    instructionTurns.size
    !== Object.keys(session.snapshot.instructionSnapshots ?? {}).length
  ) {
    throw new SessionStoreInvariantError(
      "Turn instruction journal does not match the Session snapshot"
    );
  }
  if (
    capabilityTurns.size
    !== Object.keys(session.snapshot.capabilitySnapshots ?? {}).length
  ) {
    throw new SessionStoreInvariantError(
      "Turn capability journal does not match the Session snapshot"
    );
  }
  _assertJournalReconstructsSnapshot(session);
}

function _assertJournalReconstructsSnapshot(
  session: StoredRuntimeSession
): void {
  const replayed = new Map<string, {
    checkpoint?: RuntimeRunSnapshot["checkpoint"];
    configurationId: string;
    state: RuntimeRunState;
  }>();
  for (const entry of session.journal) {
    if (
      entry.type === "sessionStateReplaced"
      || entry.type === "turnInstructionsRecorded"
      || entry.type === "turnCapabilitiesRecorded"
    ) { continue; }
    if (entry.type === "runStarted") {
      const startedState = (entry as { readonly state: unknown; }).state;
      if (startedState !== "runningModel") {
        throw new SessionStoreInvariantError(
          `Run Journal starts Runtime Run ${entry.runId} in ${String(startedState)}`
        );
      }
      if (replayed.has(entry.runId)) {
        throw new SessionStoreInvariantError(
          `Run Journal starts Runtime Run ${entry.runId} more than once`
        );
      }
      replayed.set(entry.runId, {
        configurationId: entry.configurationId,
        state: "runningModel"
      });
      continue;
    }
    const current = replayed.get(entry.runId);
    if (!current) {
      throw new SessionStoreInvariantError(
        `Run Journal references Runtime Run ${entry.runId} before it starts`
      );
    }
    if (entry.type === "runStateChanged") {
      if (entry.from !== current.state) {
        throw new SessionStoreInvariantError(
          `Run Journal entry ${entry.sequence} expected ${current.state}, found ${entry.from}`
        );
      }
      try {
        transitionRuntimeRun({
          id: entry.runId,
          sessionId: session.snapshot.id,
          configurationId: current.configurationId,
          state: current.state
        }, entry.to);
      } catch {
        throw new SessionStoreInvariantError(
          `Run Journal entry ${entry.sequence} has illegal transition ${entry.from} -> ${entry.to}`
        );
      }
      current.state = entry.to;
      continue;
    }
    if (entry.state !== current.state) {
      throw new SessionStoreInvariantError(
        `Run Journal checkpoint ${entry.sequence} records ${entry.state} while Run is ${current.state}`
      );
    }
    _assertId(
      "Continuation fingerprint",
      entry.continuationFingerprint
    );
    const expectedOrder = (current.checkpoint?.order ?? 0) + 1;
    if (entry.order !== expectedOrder) {
      throw new SessionStoreInvariantError(
        `Run Journal checkpoint ${entry.sequence} has order ${entry.order}, expected ${expectedOrder}`
      );
    }
    current.checkpoint = {
      order: entry.order,
      state: entry.state,
      continuationFingerprint: entry.continuationFingerprint
    };
  }

  for (const run of session.snapshot.runs) {
    const reconstructed = replayed.get(run.id);
    if (!reconstructed) {
      throw new SessionStoreInvariantError(
        `Run Journal does not reconstruct Runtime Run ${run.id}`
      );
    }
    if (
      reconstructed.configurationId !== run.configurationId
      || reconstructed.state !== run.state
      || !_sameCheckpoint(reconstructed.checkpoint, run.checkpoint)
    ) {
      throw new SessionStoreInvariantError(
        `Run Journal does not reconstruct Runtime Run ${run.id}`
      );
    }
  }
}

export function assertRuntimeSessionStateValues(
  values: Readonly<Record<string, RuntimeSessionStateEntry>>
): void {
  const names = Object.keys(values);
  if (names.length > MAX_SESSION_STATE_SLOTS) {
    throw new SessionStoreInvariantError(
      `Session state supports at most ${MAX_SESSION_STATE_SLOTS} slots`
    );
  }
  let totalBytes = 0;
  for (const name of names) {
    _assertId("Session state name", name);
    const entry = values[name];
    if (
      !entry
      || !Number.isSafeInteger(entry.definitionVersion)
      || entry.definitionVersion < 1
    ) {
      throw new SessionStoreInvariantError(
        `Session state "${name}" has an invalid definition version`
      );
    }
    _assertId("Session state schema fingerprint", entry.schemaFingerprint);
    _assertJsonStateValue(entry.value, name, new WeakSet());
    const bytes = new TextEncoder().encode(JSON.stringify(entry.value)).byteLength;
    if (bytes > MAX_SESSION_STATE_SLOT_BYTES) {
      throw new SessionStoreInvariantError(
        `Session state "${name}" exceeds ${MAX_SESSION_STATE_SLOT_BYTES} bytes`
      );
    }
    totalBytes += bytes;
  }
  if (totalBytes > MAX_SESSION_STATE_BYTES) {
    throw new SessionStoreInvariantError(
      `Session state exceeds ${MAX_SESSION_STATE_BYTES} bytes`
    );
  }
}

function _assertJsonStateValue(
  value: unknown,
  name: string,
  ancestors: WeakSet<object>
): void {
  if (
    value === null
    || typeof value === "string"
    || typeof value === "boolean"
  ) { return; }
  if (typeof value === "number") {
    if (Number.isFinite(value)) { return; }
    throw new SessionStoreInvariantError(
      `Session state "${name}" contains a non-finite number`
    );
  }
  if (!value || typeof value !== "object") {
    throw new SessionStoreInvariantError(
      `Session state "${name}" contains a non-JSON value`
    );
  }
  if (ancestors.has(value)) {
    throw new SessionStoreInvariantError(
      `Session state "${name}" contains circular data`
    );
  }
  const prototype = Object.getPrototypeOf(value) as object | null;
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    throw new SessionStoreInvariantError(
      `Session state "${name}" contains a non-plain object`
    );
  }
  ancestors.add(value);
  for (const child of Array.isArray(value) ? value : Object.values(value)) {
    _assertJsonStateValue(child, name, ancestors);
  }
  ancestors.delete(value);
}

function _sameCheckpoint(
  left: RuntimeRunSnapshot["checkpoint"],
  right: RuntimeRunSnapshot["checkpoint"]
): boolean {
  if (!left || !right) {
    return left === right;
  }
  return left.order === right.order
    && left.state === right.state
    && left.continuationFingerprint === right.continuationFingerprint;
}
