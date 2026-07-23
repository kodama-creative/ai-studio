import { deriveCapabilitySnapshotFingerprint } from "./derive-capability-snapshot-fingerprint";
import { deriveInstructionSnapshotContent } from "./derive-instruction-snapshot-content";
import {
  MAX_DURABLE_OPERATION_REPLAY_BYTES,
  MAX_DURABLE_STEP_REPLAY_BYTES,
  RUNTIME_DURABLE_OPERATION_STATES,
  RUNTIME_OPERATION_LEDGER_SCHEMA_VERSION,
  type RuntimeDurableOperationSnapshot,
  type RuntimeDurableStepSnapshot
} from "./durable-operation";
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
import { sha256 } from "./sha256";
import { UnsupportedRuntimeSessionSchemaError } from "./unsupported-runtime-session-schema-error";

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
const OPERATION_STATES = new Set<string>(RUNTIME_DURABLE_OPERATION_STATES);

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
      await _assertOperationReplayIntegrity(stored.snapshot);
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
      if (mutation.type === "settleOperation" && mutation.replay) {
        await _assertReplayEnvelopeIntegrity(mutation.replay);
      }
    }

    let current = this._sessions.get(input.sessionId);
    if (current) {
      await _assertInstructionSnapshotIntegrity(current.snapshot);
      await _assertCapabilitySnapshotIntegrity(current.snapshot);
      await _assertOperationReplayIntegrity(current.snapshot);
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
    _assertStoredSession(stored);
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
  if (mutation.type === "startOperation") {
    _startOperation({ journal, mutation, sessionVersion, snapshot });
    return;
  }
  if (mutation.type === "settleOperation") {
    _settleOperation({ journal, mutation, sessionVersion, snapshot });
    return;
  }
  if (mutation.type === "checkpointOperationStep") {
    _checkpointOperationStep({ journal, mutation, sessionVersion, snapshot });
    return;
  }
  if (mutation.type === "resumeOperation") {
    _resumeOperation({ journal, mutation, sessionVersion, snapshot });
    return;
  }
  _recordCheckpoint({ journal, mutation, sessionVersion, snapshot });
}

function _resumeOperation({
  journal,
  mutation,
  sessionVersion,
  snapshot
}: {
  journal: RuntimeRunJournalEntry[];
  mutation: Extract<RuntimeSessionMutation, { type: "resumeOperation"; }>;
  sessionVersion: number;
  snapshot: RuntimeSessionSnapshot;
}): void {
  const ledger = snapshot.operationLedger;
  const stepIndex = ledger?.steps.findIndex(step =>
    step.operations.some(operation => operation.id === mutation.operationId))
  ?? -1;
  const step = ledger?.steps[stepIndex];
  const operationIndex = step?.operations.findIndex(
    operation => operation.id === mutation.operationId
  ) ?? -1;
  const operation = step?.operations[operationIndex];
  if (
    !ledger
    || !step
    || operation?.runId !== mutation.runId
    || operation.state !== "parked"
    || !operation.park
  ) {
    throw new SessionStoreInvariantError(
      `Durable operation ${mutation.operationId} is not parked in Runtime Run ${mutation.runId}`
    );
  }
  if (
    operation.park.parkId !== mutation.parkId
    || operation.park.resumeSchemaFingerprint
    !== mutation.resumeSchemaFingerprint
  ) {
    throw new SessionStoreInvariantError(
      `Durable operation ${mutation.operationId} park identity changed`
    );
  }
  if (operation.requestFingerprint !== mutation.requestFingerprint) {
    throw new SessionStoreInvariantError(
      `Durable operation ${mutation.operationId} request fingerprint changed`
    );
  }
  const operations = [...step.operations];
  const { park: _park, ...resumed } = operation;
  operations[operationIndex] = { ...resumed, state: "preCall" };
  const steps = [...ledger.steps];
  steps[stepIndex] = { ...step, operations };
  (snapshot as { operationLedger?: RuntimeSessionSnapshot["operationLedger"]; })
    .operationLedger = { ...ledger, steps };
  journal.push({
    type: "operationResumed",
    sequence: journal.length + 1,
    sessionVersion,
    runId: mutation.runId,
    stepId: step.id,
    operationId: mutation.operationId,
    parkId: mutation.parkId
  });
}

function _startOperation({
  journal,
  mutation,
  sessionVersion,
  snapshot
}: {
  journal: RuntimeRunJournalEntry[];
  mutation: Extract<RuntimeSessionMutation, { type: "startOperation"; }>;
  sessionVersion: number;
  snapshot: RuntimeSessionSnapshot;
}): void {
  _assertId("Runtime Run", mutation.runId);
  _assertId("Durable Step", mutation.stepId);
  _assertId("Durable operation", mutation.operationId);
  _assertSha256("Operation request fingerprint", mutation.requestFingerprint);
  const run = snapshot.runs.find(item => item.id === mutation.runId);
  if (!run || snapshot.activeRunId !== mutation.runId) {
    throw new SessionStoreInvariantError(
      `Runtime Run ${mutation.runId} is not active for durable operation ${mutation.operationId}`
    );
  }
  if (
    !Number.isSafeInteger(mutation.stepSequence)
    || mutation.stepSequence < 1
  ) {
    throw new SessionStoreInvariantError(
      "Durable Step sequence must be a positive safe integer"
    );
  }
  if (
    !Number.isSafeInteger(mutation.transcriptMessageCount)
    || mutation.transcriptMessageCount < 0
  ) {
    throw new SessionStoreInvariantError(
      "Durable Step transcript boundary must be a non-negative safe integer"
    );
  }
  if (mutation.kind === "provider") {
    _assertId("Operation provider", mutation.provider ?? "");
    if (mutation.toolCallId !== undefined) {
      throw new SessionStoreInvariantError(
        "Provider operation cannot contain a tool-call identity"
      );
    }
  } else {
    _assertId("Operation tool call", mutation.toolCallId ?? "");
    if (mutation.provider !== undefined) {
      throw new SessionStoreInvariantError(
        "Tool operation cannot contain a provider identity"
      );
    }
  }
  if (mutation.park) {
    _assertId("Operation park", mutation.park.parkId);
    if (typeof mutation.park.reason !== "string") {
      throw new SessionStoreInvariantError("Operation park reason must be text");
    }
    _assertSha256(
      "Operation resume schema fingerprint",
      mutation.park.resumeSchemaFingerprint
    );
  }
  const ledger = snapshot.operationLedger ?? {
    schemaVersion: RUNTIME_OPERATION_LEDGER_SCHEMA_VERSION,
    steps: []
  };
  const steps = [...ledger.steps];
  if (steps.some(step => step.operations.some(
    operation => operation.id === mutation.operationId
  ))) {
    throw new SessionStoreInvariantError(
      `Durable operation ${mutation.operationId} already exists`
    );
  }
  let stepIndex = steps.findIndex(step => step.id === mutation.stepId);
  let step = steps[stepIndex];
  if (!step) {
    const runSteps = steps.filter(item => item.runId === mutation.runId);
    if (runSteps.some(item => item.state === "active")) {
      throw new SessionStoreInvariantError(
        `Runtime Run ${mutation.runId} already has an active durable Step`
      );
    }
    const expectedSequence = Math.max(0, ...runSteps.map(item => item.sequence)) + 1;
    if (mutation.stepSequence !== expectedSequence) {
      throw new SessionStoreInvariantError(
        `Durable Step ${mutation.stepId} expected sequence ${expectedSequence}, found ${mutation.stepSequence}`
      );
    }
    step = {
      id: mutation.stepId,
      runId: mutation.runId,
      sequence: mutation.stepSequence,
      state: "active",
      transcriptMessageCount: mutation.transcriptMessageCount,
      operations: []
    };
    stepIndex = steps.length;
    steps.push(step);
  } else if (
    step.runId !== mutation.runId
    || step.sequence !== mutation.stepSequence
    || step.state !== "active"
    || step.transcriptMessageCount !== mutation.transcriptMessageCount
  ) {
    throw new SessionStoreInvariantError(
      `Durable Step ${mutation.stepId} is not the requested active Step`
    );
  }
  const operation: RuntimeDurableOperationSnapshot = {
    attempt: 1,
    id: mutation.operationId,
    idempotency: { mode: "none" },
    kind: mutation.kind,
    requestFingerprint: mutation.requestFingerprint,
    runId: mutation.runId,
    startedAt: Date.now(),
    state: mutation.park ? "parked" : "preCall",
    stepId: mutation.stepId,
    ...(mutation.provider ? { provider: mutation.provider } : {}),
    ...(mutation.toolCallId ? { toolCallId: mutation.toolCallId } : {}),
    ...(mutation.park
      ? {
        park: {
          ...mutation.park,
          parkedSessionVersion: sessionVersion
        }
      }
      : {})
  };
  steps[stepIndex] = {
    ...step,
    operations: [...step.operations, operation]
  };
  (snapshot as { operationLedger?: RuntimeSessionSnapshot["operationLedger"]; })
    .operationLedger = { ...ledger, steps };
  journal.push({
    type: "operationStarted",
    sequence: journal.length + 1,
    sessionVersion,
    runId: mutation.runId,
    stepId: mutation.stepId,
    operationId: mutation.operationId,
    requestFingerprint: mutation.requestFingerprint,
    state: mutation.park ? "parked" : "preCall"
  });
}

function _settleOperation({
  journal,
  mutation,
  sessionVersion,
  snapshot
}: {
  journal: RuntimeRunJournalEntry[];
  mutation: Extract<RuntimeSessionMutation, { type: "settleOperation"; }>;
  sessionVersion: number;
  snapshot: RuntimeSessionSnapshot;
}): void {
  const ledger = snapshot.operationLedger;
  const stepIndex = ledger?.steps.findIndex(step =>
    step.operations.some(operation => operation.id === mutation.operationId))
  ?? -1;
  const step = ledger?.steps[stepIndex];
  const operationIndex = step?.operations.findIndex(
    operation => operation.id === mutation.operationId
  ) ?? -1;
  const operation = step?.operations[operationIndex];
  if (!ledger || !step || !operation) {
    throw new SessionStoreInvariantError(
      `Durable operation ${mutation.operationId} does not exist`
    );
  }
  if (
    step.state !== "active"
    || operation.runId !== mutation.runId
    || operation.state !== "preCall"
  ) {
    throw new SessionStoreInvariantError(
      `Durable operation ${mutation.operationId} cannot settle from ${operation.state}`
    );
  }
  if (operation.requestFingerprint !== mutation.requestFingerprint) {
    throw new SessionStoreInvariantError(
      `Durable operation ${mutation.operationId} request fingerprint changed`
    );
  }
  const replayRequired = mutation.state === "completed"
    || mutation.state === "failed";
  if (replayRequired !== Boolean(mutation.replay)) {
    throw new SessionStoreInvariantError(
      `Durable operation ${mutation.operationId} has invalid replay material for ${mutation.state}`
    );
  }
  if (mutation.replay) {
    _assertReplayEnvelope(mutation.replay);
    const existingBytes = step.operations.reduce(
      (total, item) => total + (item.replay?.byteLength ?? 0),
      0
    );
    if (existingBytes + mutation.replay.byteLength > MAX_DURABLE_STEP_REPLAY_BYTES) {
      throw new SessionStoreInvariantError(
        `Durable Step ${step.id} replay material exceeds ${MAX_DURABLE_STEP_REPLAY_BYTES} bytes`
      );
    }
  }
  const operations = [...step.operations];
  operations[operationIndex] = {
    ...operation,
    state: mutation.state,
    settledAt: Date.now(),
    ...(mutation.replay
      ? {
        replayByteLength: mutation.replay.byteLength,
        resultFingerprint: mutation.replay.resultFingerprint
      }
      : {}),
    ...(mutation.replay ? { replay: structuredClone(mutation.replay) } : {})
  };
  const steps = [...ledger.steps];
  steps[stepIndex] = { ...step, operations };
  (snapshot as { operationLedger?: RuntimeSessionSnapshot["operationLedger"]; })
    .operationLedger = { ...ledger, steps };
  journal.push({
    type: "operationSettled",
    sequence: journal.length + 1,
    sessionVersion,
    runId: mutation.runId,
    stepId: step.id,
    operationId: mutation.operationId,
    requestFingerprint: mutation.requestFingerprint,
    state: mutation.state
  });
}

function _checkpointOperationStep({
  journal,
  mutation,
  sessionVersion,
  snapshot
}: {
  journal: RuntimeRunJournalEntry[];
  mutation: Extract<RuntimeSessionMutation, { type: "checkpointOperationStep"; }>;
  sessionVersion: number;
  snapshot: RuntimeSessionSnapshot;
}): void {
  const ledger = snapshot.operationLedger;
  const stepIndex = ledger?.steps.findIndex(step => step.id === mutation.stepId)
    ?? -1;
  const step = ledger?.steps[stepIndex];
  if (!ledger || step?.runId !== mutation.runId) {
    throw new SessionStoreInvariantError(
      `Durable Step ${mutation.stepId} does not exist in Runtime Run ${mutation.runId}`
    );
  }
  if (step.state !== "active") {
    throw new SessionStoreInvariantError(
      `Durable Step ${step.id} is already checkpointed`
    );
  }
  if (step.operations.some(operation =>
    operation.state === "preCall" || operation.state === "parked")) {
    throw new SessionStoreInvariantError(
      `Durable Step ${step.id} cannot checkpoint with unsettled operations`
    );
  }
  const steps = [...ledger.steps];
  steps[stepIndex] = {
    ...step,
    state: "checkpointed",
    operations: step.operations.map(({ replay: _replay, ...operation }) =>
      operation)
  };
  (snapshot as { operationLedger?: RuntimeSessionSnapshot["operationLedger"]; })
    .operationLedger = { ...ledger, steps };
  journal.push({
    type: "operationStepCheckpointed",
    sequence: journal.length + 1,
    sessionVersion,
    runId: mutation.runId,
    stepId: mutation.stepId
  });
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
  if (mutation.structuredOutput && mutation.to !== "completed") {
    throw new SessionStoreInvariantError(
      "Structured output can be stored only on a completed Runtime Run"
    );
  }
  if (mutation.structuredOutput) {
    _assertStructuredOutput(mutation.structuredOutput);
  }
  (snapshot.runs as RuntimeRunSnapshot[])[runIndex] = mutation.structuredOutput
    ? { ...next, structuredOutput: structuredClone(mutation.structuredOutput) }
    : next;
  if (isTerminalRuntimeRunState(next.state)) {
    _settleInterruptedOperationsForTerminal({
      journal,
      runId: run.id,
      sessionVersion,
      snapshot,
      terminal: next.state
    });
    _checkpointActiveOperationSteps({
      journal,
      runId: run.id,
      sessionVersion,
      snapshot
    });
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
  _checkpointActiveOperationSteps({
    journal,
    runId: run.id,
    sessionVersion,
    snapshot
  });
  journal.push({
    type: "runCheckpointRecorded",
    sequence: journal.length + 1,
    sessionVersion,
    runId: run.id,
    ...checkpoint
  });
}

function _settleInterruptedOperationsForTerminal({
  journal,
  runId,
  sessionVersion,
  snapshot,
  terminal
}: {
  journal: RuntimeRunJournalEntry[];
  runId: string;
  sessionVersion: number;
  snapshot: RuntimeSessionSnapshot;
  terminal: RuntimeRunState;
}): void {
  const ledger = snapshot.operationLedger;
  if (!ledger) { return; }
  const steps = [...ledger.steps];
  let changed = false;
  for (const [stepIndex, step] of steps.entries()) {
    if (step.runId !== runId || step.state !== "active") { continue; }
    const operations: RuntimeDurableOperationSnapshot[] = [];
    for (const operation of step.operations) {
      if (operation.state !== "preCall") {
        operations.push(operation);
        continue;
      }
      if (terminal !== "outcomeUnknown") {
        throw new SessionStoreInvariantError(
          `Runtime Run ${runId} cannot become ${terminal} with pre-call operation ${operation.id}`
        );
      }
      changed = true;
      journal.push({
        type: "operationSettled",
        sequence: journal.length + 1,
        sessionVersion,
        runId,
        stepId: step.id,
        operationId: operation.id,
        requestFingerprint: operation.requestFingerprint,
        state: "outcomeUnknown"
      });
      operations.push({
        ...operation,
        state: "outcomeUnknown",
        settledAt: Date.now()
      });
    }
    steps[stepIndex] = { ...step, operations };
  }
  if (changed) {
    (snapshot as { operationLedger?: RuntimeSessionSnapshot["operationLedger"]; })
      .operationLedger = { ...ledger, steps };
  }
}

function _checkpointActiveOperationSteps({
  journal,
  runId,
  sessionVersion,
  snapshot
}: {
  journal: RuntimeRunJournalEntry[];
  runId: string;
  sessionVersion: number;
  snapshot: RuntimeSessionSnapshot;
}): void {
  const active = snapshot.operationLedger?.steps.filter(
    step => step.runId === runId && step.state === "active"
  ) ?? [];
  for (const step of active) {
    _checkpointOperationStep({
      journal,
      mutation: {
        type: "checkpointOperationStep",
        runId,
        stepId: step.id
      },
      sessionVersion,
      snapshot
    });
  }
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
  if (configuration.outputContract) {
    _assertId("Output contract name", configuration.outputContract.name);
    if (!/^[0-9a-f]{64}$/.test(configuration.outputContract.schemaFingerprint)) {
      throw new SessionStoreInvariantError(
        "Output contract schema fingerprint must be lowercase SHA-256"
      );
    }
  }
  if (
    configuration.maxStructuredOutputBytes !== undefined
    && (!Number.isSafeInteger(configuration.maxStructuredOutputBytes)
      || configuration.maxStructuredOutputBytes < 1024
      || configuration.maxStructuredOutputBytes > 768 * 1024)
  ) {
    throw new SessionStoreInvariantError(
      "Structured output limit must be an integer from 1024 through 786432"
    );
  }
}

function _assertStructuredOutput(
  result: NonNullable<RuntimeRunSnapshot["structuredOutput"]>
): void {
  _assertId("Structured output contract", result.contract);
  if (!/^[0-9a-f]{64}$/.test(result.schemaFingerprint)) {
    throw new SessionStoreInvariantError(
      "Structured output schema fingerprint must be lowercase SHA-256"
    );
  }
  if (!_isJsonValue(result.value, new WeakSet())) {
    throw new SessionStoreInvariantError("Structured output must be JSON data");
  }
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

function _assertOperationLedger(snapshot: RuntimeSessionSnapshot): void {
  const ledger = snapshot.operationLedger;
  if (!ledger) { return; }
  if (ledger.schemaVersion !== RUNTIME_OPERATION_LEDGER_SCHEMA_VERSION) {
    throw new SessionStoreInvariantError(
      `Unsupported durable operation ledger schema: ${String(ledger.schemaVersion)}`
    );
  }
  const stepIds = new Set<string>();
  const operationIds = new Set<string>();
  const sequences = new Map<string, number>();
  const activeRuns = new Set<string>();
  for (const step of ledger.steps) {
    _assertId("Durable Step", step.id);
    _assertId("Runtime Run", step.runId);
    if (stepIds.has(step.id)) {
      throw new SessionStoreInvariantError(
        `Durable Step ${step.id} is duplicated`
      );
    }
    stepIds.add(step.id);
    const expectedSequence = (sequences.get(step.runId) ?? 0) + 1;
    if (step.sequence !== expectedSequence) {
      throw new SessionStoreInvariantError(
        `Runtime Run ${step.runId} durable Step sequence is not contiguous at ${expectedSequence}`
      );
    }
    sequences.set(step.runId, step.sequence);
    if (step.state !== "active" && step.state !== "checkpointed") {
      throw new SessionStoreInvariantError(
        `Durable Step ${step.id} has invalid state ${String(step.state)}`
      );
    }
    if (
      !Number.isSafeInteger(step.transcriptMessageCount)
      || step.transcriptMessageCount < 0
    ) {
      throw new SessionStoreInvariantError(
        `Durable Step ${step.id} has an invalid transcript boundary`
      );
    }
    if (step.state === "active") {
      if (activeRuns.has(step.runId)) {
        throw new SessionStoreInvariantError(
          `Runtime Run ${step.runId} has more than one active durable Step`
        );
      }
      activeRuns.add(step.runId);
    }
    let replayBytes = 0;
    for (const operation of step.operations) {
      _assertOperationSnapshot(operation, step);
      if (operationIds.has(operation.id)) {
        throw new SessionStoreInvariantError(
          `Durable operation ${operation.id} is duplicated`
        );
      }
      operationIds.add(operation.id);
      replayBytes += operation.replay?.byteLength ?? 0;
    }
    if (replayBytes > MAX_DURABLE_STEP_REPLAY_BYTES) {
      throw new SessionStoreInvariantError(
        `Durable Step ${step.id} replay material exceeds ${MAX_DURABLE_STEP_REPLAY_BYTES} bytes`
      );
    }
  }
}

function _assertOperationSnapshot(
  operation: RuntimeDurableOperationSnapshot,
  step: RuntimeDurableStepSnapshot
): void {
  _assertId("Durable operation", operation.id);
  _assertSha256("Operation request fingerprint", operation.requestFingerprint);
  if (
    operation.runId !== step.runId
    || operation.stepId !== step.id
    || operation.attempt !== 1
    || operation.idempotency.mode !== "none"
    || !OPERATION_STATES.has(operation.state)
  ) {
    throw new SessionStoreInvariantError(
      `Durable operation ${operation.id} has invalid identity or state`
    );
  }
  if (
    !Number.isSafeInteger(operation.startedAt)
    || operation.startedAt < 0
  ) {
    throw new SessionStoreInvariantError(
      `Durable operation ${operation.id} has an invalid start timestamp`
    );
  }
  if (operation.kind === "provider") {
    _assertId("Operation provider", operation.provider ?? "");
    if (operation.toolCallId !== undefined) {
      throw new SessionStoreInvariantError(
        `Provider operation ${operation.id} has a tool-call identity`
      );
    }
  } else if (operation.kind === "tool") {
    _assertId("Operation tool call", operation.toolCallId ?? "");
    if (operation.provider !== undefined) {
      throw new SessionStoreInvariantError(
        `Tool operation ${operation.id} has a provider identity`
      );
    }
  } else {
    throw new SessionStoreInvariantError(
      `Durable operation ${operation.id} has invalid kind`
    );
  }
  if (operation.park) {
    if (operation.state !== "parked") {
      throw new SessionStoreInvariantError(
        `Durable operation ${operation.id} retains park metadata after ${operation.state}`
      );
    }
    _assertId("Operation park", operation.park.parkId);
    _assertSha256(
      "Operation resume schema fingerprint",
      operation.park.resumeSchemaFingerprint
    );
    if (
      typeof operation.park.reason !== "string"
      || !Number.isSafeInteger(operation.park.parkedSessionVersion)
      || operation.park.parkedSessionVersion < 1
    ) {
      throw new SessionStoreInvariantError(
        `Durable operation ${operation.id} has invalid park metadata`
      );
    }
  } else if (operation.state === "parked") {
    throw new SessionStoreInvariantError(
      `Durable operation ${operation.id} is parked without park metadata`
    );
  }
  const replayRequired = step.state === "active"
    && (operation.state === "completed" || operation.state === "failed");
  if (replayRequired !== Boolean(operation.replay)) {
    throw new SessionStoreInvariantError(
      `Durable operation ${operation.id} has invalid replay retention`
    );
  }
  if (operation.replay) {
    _assertReplayEnvelope(operation.replay);
  }
  const settled = operation.state === "cancelled"
    || operation.state === "completed"
    || operation.state === "failed"
    || operation.state === "outcomeUnknown";
  if (
    settled !== Number.isSafeInteger(operation.settledAt)
    || (operation.settledAt !== undefined && operation.settledAt < 0)
  ) {
    throw new SessionStoreInvariantError(
      `Durable operation ${operation.id} has invalid settlement metadata`
    );
  }
  const hasResult = operation.state === "completed"
    || operation.state === "failed";
  if (
    hasResult !== Boolean(operation.resultFingerprint)
    || hasResult !== Number.isSafeInteger(operation.replayByteLength)
    || (operation.resultFingerprint !== undefined
      && !/^[0-9a-f]{64}$/.test(operation.resultFingerprint))
    || (operation.replayByteLength !== undefined
      && (
        operation.replayByteLength < 0
        || operation.replayByteLength > MAX_DURABLE_OPERATION_REPLAY_BYTES
      ))
      || (operation.replay
        && (
          operation.resultFingerprint !== operation.replay.resultFingerprint
          || operation.replayByteLength !== operation.replay.byteLength
        ))
  ) {
    throw new SessionStoreInvariantError(
      `Durable operation ${operation.id} has invalid retained result metadata`
    );
  }
}

function _assertReplayEnvelope(
  replay: NonNullable<RuntimeDurableOperationSnapshot["replay"]>
): void {
  if (!_isJsonValue(replay.value, new WeakSet())) {
    throw new SessionStoreInvariantError(
      "Durable operation replay material must be JSON data"
    );
  }
  const actualBytes = new TextEncoder().encode(
    _canonicalJson(replay.value)
  ).byteLength;
  if (
    !Number.isSafeInteger(replay.byteLength)
    || replay.byteLength !== actualBytes
    || replay.byteLength > MAX_DURABLE_OPERATION_REPLAY_BYTES
  ) {
    throw new SessionStoreInvariantError(
      `Durable operation replay material has invalid byte length ${String(replay.byteLength)}`
    );
  }
  _assertSha256("Operation result fingerprint", replay.resultFingerprint);
}

async function _assertReplayEnvelopeIntegrity(
  replay: NonNullable<RuntimeDurableOperationSnapshot["replay"]>
): Promise<void> {
  _assertReplayEnvelope(replay);
  if (replay.resultFingerprint !== await sha256(_canonicalJson(replay.value))) {
    throw new SessionStoreInvariantError(
      "Durable operation result fingerprint does not match replay material"
    );
  }
}

async function _assertOperationReplayIntegrity(
  snapshot: RuntimeSessionSnapshot
): Promise<void> {
  for (const step of snapshot.operationLedger?.steps ?? []) {
    for (const operation of step.operations) {
      if (operation.replay) {
        await _assertReplayEnvelopeIntegrity(operation.replay);
      }
    }
  }
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

function _assertSha256(label: string, value: string): void {
  if (!/^[0-9a-f]{64}$/.test(value)) {
    throw new SessionStoreInvariantError(`${label} must be lowercase SHA-256`);
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
    if (tool.executionEnvToolKind !== undefined) {
      if (
        !["bash", "read", "write"].includes(tool.executionEnvToolKind)
        || tool.name !== tool.executionEnvToolKind
        || tool.requiresExecutionEnv !== true
      ) {
        throw new SessionStoreInvariantError(
          `ExecutionEnv tool ${tool.name} has invalid capability identity`
        );
      }
    } else if (tool.requiresExecutionEnv !== undefined) {
      throw new SessionStoreInvariantError(
        `Tool ${tool.name} has an invalid ExecutionEnv requirement`
      );
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
    && JSON.stringify(left.outputContract ?? null)
    === JSON.stringify(right.outputContract ?? null)
    && left.maxStructuredOutputBytes === right.maxStructuredOutputBytes
  );
}

function _assertStoredSession(session: StoredRuntimeSession): void {
  if (!Number.isSafeInteger(session.version) || session.version < 1) {
    throw new SessionStoreInvariantError(
      "Stored Session version must be a positive safe integer"
    );
  }
  if (session.snapshot.schemaVersion !== RUNTIME_SESSION_SCHEMA_VERSION) {
    throw new UnsupportedRuntimeSessionSchemaError(
      session.snapshot.schemaVersion
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
  _assertOperationLedger(session.snapshot);
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
    if (run.structuredOutput) {
      if (run.state !== "completed") {
        throw new SessionStoreInvariantError(
          `Runtime Run ${run.id} has structured output before completion`
        );
      }
      _assertStructuredOutput(run.structuredOutput);
    }
    const configuration = configurations.get(run.configurationId);
    if (!configuration) {
      throw new SessionStoreInvariantError(
        `Runtime Run ${run.id} references missing configuration ${run.configurationId}`
      );
    }
    if (run.structuredOutput) {
      if (
        configuration.outputContract?.name !== run.structuredOutput.contract
        || configuration.outputContract.schemaFingerprint
        !== run.structuredOutput.schemaFingerprint
      ) {
        throw new SessionStoreInvariantError(
          `Runtime Run ${run.id} structured output does not match its configuration`
        );
      }
      const maxBytes = configuration.maxStructuredOutputBytes;
      if (
        maxBytes !== undefined
        && new TextEncoder().encode(_canonicalJson(run.structuredOutput.value))
          .byteLength > maxBytes
      ) {
        throw new SessionStoreInvariantError(
          `Runtime Run ${run.id} structured output exceeds its configured limit`
        );
      }
    } else if (configuration.outputContract && run.state === "completed") {
      throw new SessionStoreInvariantError(
        `Runtime Run ${run.id} completed without its configured structured output`
      );
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
    if (
      entry.type === "operationStarted"
      || entry.type === "operationSettled"
      || entry.type === "operationStepCheckpointed"
      || entry.type === "operationResumed"
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
