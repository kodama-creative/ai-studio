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
import {
  RUNTIME_TOOL_APPROVAL_LEDGER_SCHEMA_VERSION,
  RUNTIME_TOOL_APPROVAL_REQUEST_STATES,
  type RuntimeToolApprovalGrantSnapshot,
  type RuntimeToolApprovalRequestSnapshot
} from "./durable-tool-approval";
import { immutableSnapshot } from "./immutable-snapshot";
import {
  emptyRuntimeHistory,
  MAX_RUNTIME_BRANCH_LABEL_LENGTH,
  RUNTIME_HISTORY_SCHEMA_VERSION,
  runtimeBranchContainsCheckpoint,
  type RuntimeBranchSnapshot,
  type RuntimeCheckpointSnapshot,
  runtimeEntryIsAncestor,
  runtimeHistoryCheckpointPath,
  type RuntimeHistoryMessageEntrySnapshot,
  runtimeHistoryMessagePath,
  type RuntimeHistorySnapshot
} from "./runtime-history";
import {
  isTerminalRuntimeRunState,
  RUNTIME_RUN_STATES,
  type RuntimeJsonValue,
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
import { isApprovalRequirement } from "../../public/definitions/approval";

const CHECKPOINT_STATES = new Set([
  "waitingForApproval",
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
const APPROVAL_REQUEST_STATES = new Set<string>(
  RUNTIME_TOOL_APPROVAL_REQUEST_STATES
);

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
      await _assertRuntimeHistoryIntegrity(stored.snapshot.history);
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
      if (mutation.type === "recordCompaction") {
        _assertSha256(
          "Compaction summary fingerprint",
          mutation.summaryFingerprint
        );
        if (mutation.summaryFingerprint !== await sha256(mutation.summary)) {
          throw new SessionStoreInvariantError(
            "Compaction summary fingerprint does not match its content"
          );
        }
      }
    }

    let current = this._sessions.get(input.sessionId);
    if (current) {
      await _assertInstructionSnapshotIntegrity(current.snapshot);
      await _assertCapabilitySnapshotIntegrity(current.snapshot);
      await _assertOperationReplayIntegrity(current.snapshot);
      await _assertRuntimeHistoryIntegrity(current.snapshot.history);
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
        history: emptyRuntimeHistory(),
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
      await _applyMutation({
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
    await _assertRuntimeHistoryIntegrity(stored.snapshot.history);
    const finalActualVersion = this._sessions.get(input.sessionId)?.version
      ?? null;
    if (finalActualVersion !== actualVersion) {
      throw new SessionStoreConflictError(
        input.sessionId,
        input.expectedVersion,
        finalActualVersion
      );
    }
    this._sessions.set(input.sessionId, stored);
    return Promise.resolve(immutableSnapshot(stored));
  }
}

async function _applyMutation({
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
}): Promise<void> {
  if (mutation.type === "startRun") {
    await _startRun({
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
  if (mutation.type === "requestToolApproval") {
    _requestToolApproval({ journal, mutation, sessionVersion, snapshot });
    return;
  }
  if (mutation.type === "decideToolApproval") {
    _decideToolApproval({ journal, mutation, sessionVersion, snapshot });
    return;
  }
  if (mutation.type === "staleToolApproval") {
    _staleToolApproval({ journal, mutation, sessionVersion, snapshot });
    return;
  }
  if (mutation.type === "renameBranch") {
    _renameBranch({ journal, mutation, sessionVersion, snapshot });
    return;
  }
  if (mutation.type === "recordCompaction") {
    _recordCompaction({
      configurationById,
      journal,
      mutation,
      sessionVersion,
      snapshot
    });
    return;
  }
  await _recordCheckpoint({ journal, mutation, sessionVersion, snapshot });
}

function _requestToolApproval({
  journal,
  mutation,
  sessionVersion,
  snapshot
}: {
  journal: RuntimeRunJournalEntry[];
  mutation: Extract<RuntimeSessionMutation, { type: "requestToolApproval"; }>;
  sessionVersion: number;
  snapshot: RuntimeSessionSnapshot;
}): void {
  for (const [label, value] of [
    ["Tool approval", mutation.requestId],
    ["Runtime Run", mutation.runId],
    ["Durable Step", mutation.stepId],
    ["Durable operation", mutation.operationId],
    ["Operation tool call", mutation.toolCallId],
    ["Approval tool name", mutation.toolName],
    ["Approval contribution", mutation.contributionId],
    ["Agent snapshot fingerprint", mutation.agentSnapshotFingerprint]
  ] as const) {
    _assertId(label, value);
  }
  _assertSha256("Approval request fingerprint", mutation.requestFingerprint);
  _assertSha256(
    "Approval source-policy fingerprint",
    mutation.sourcePolicyFingerprint
  );
  _assertSha256(
    "Approval Host-policy fingerprint",
    mutation.hostPolicyFingerprint
  );
  _assertSha256(
    "Approval current-principal fingerprint",
    mutation.currentPrincipalFingerprint
  );
  _assertSha256(
    "Approval initiator-principal fingerprint",
    mutation.initiatorPrincipalFingerprint
  );
  if (
    mutation.reason !== undefined
    && (mutation.reason.trim().length === 0 || mutation.reason.length > 1_024)
  ) {
    throw new SessionStoreInvariantError(
      "Tool approval reason must contain 1-1024 characters"
    );
  }
  if (snapshot.activeRunId !== mutation.runId) {
    throw new SessionStoreInvariantError(
      `Runtime Run ${mutation.runId} is not active for tool approval ${mutation.requestId}`
    );
  }
  const operation = snapshot.operationLedger?.steps
    .find(step => step.id === mutation.stepId)
    ?.operations.find(item => item.id === mutation.operationId);
  if (
    operation?.runId !== mutation.runId
    || operation.state !== "parked"
    || operation.toolCallId !== mutation.toolCallId
    || operation.requestFingerprint !== mutation.requestFingerprint
    || operation.park?.parkId !== mutation.requestId
  ) {
    throw new SessionStoreInvariantError(
      `Tool approval ${mutation.requestId} does not match its parked operation`
    );
  }
  const ledger = snapshot.approvalLedger ?? {
    schemaVersion: RUNTIME_TOOL_APPROVAL_LEDGER_SCHEMA_VERSION,
    requests: [],
    grants: []
  };
  if (ledger.requests.some(request => request.id === mutation.requestId)) {
    throw new SessionStoreInvariantError(
      `Tool approval ${mutation.requestId} already exists`
    );
  }
  const request: RuntimeToolApprovalRequestSnapshot = {
    id: mutation.requestId,
    runId: mutation.runId,
    stepId: mutation.stepId,
    operationId: mutation.operationId,
    toolCallId: mutation.toolCallId,
    toolName: mutation.toolName,
    contributionId: mutation.contributionId,
    requestFingerprint: mutation.requestFingerprint,
    agentSnapshotFingerprint: mutation.agentSnapshotFingerprint,
    sourcePolicyFingerprint: mutation.sourcePolicyFingerprint,
    sourceRequirement: mutation.sourceRequirement,
    hostRequirement: mutation.hostRequirement,
    hostPolicyFingerprint: mutation.hostPolicyFingerprint,
    currentPrincipalFingerprint: mutation.currentPrincipalFingerprint,
    initiatorPrincipalFingerprint: mutation.initiatorPrincipalFingerprint,
    scope: mutation.scope,
    state: "pending",
    requestedAt: Date.now(),
    ...(mutation.reason ? { reason: mutation.reason } : {})
  };
  (snapshot as { approvalLedger?: RuntimeSessionSnapshot["approvalLedger"]; })
    .approvalLedger = {
      ...ledger,
      requests: [...ledger.requests, request]
    };
  journal.push({
    type: "toolApprovalRequested",
    sequence: journal.length + 1,
    sessionVersion,
    requestId: mutation.requestId,
    runId: mutation.runId,
    toolCallId: mutation.toolCallId,
    state: "pending"
  });
}

function _decideToolApproval({
  journal,
  mutation,
  sessionVersion,
  snapshot
}: {
  journal: RuntimeRunJournalEntry[];
  mutation: Extract<RuntimeSessionMutation, { type: "decideToolApproval"; }>;
  sessionVersion: number;
  snapshot: RuntimeSessionSnapshot;
}): void {
  const ledger = snapshot.approvalLedger;
  const requestIndex = ledger?.requests.findIndex(
    request => request.id === mutation.requestId
  ) ?? -1;
  const request = ledger?.requests[requestIndex];
  if (
    !ledger
    || request?.runId !== mutation.runId
    || request.state !== "pending"
    || snapshot.activeRunId !== mutation.runId
  ) {
    throw new SessionStoreInvariantError(
      `Tool approval ${mutation.requestId} is not pending in Runtime Run ${mutation.runId}`
    );
  }
  if (
    request.currentPrincipalFingerprint
    !== mutation.currentPrincipalFingerprint
    || request.initiatorPrincipalFingerprint
    !== mutation.initiatorPrincipalFingerprint
  ) {
    throw new SessionStoreInvariantError(
      `Tool approval ${mutation.requestId} principal identity changed`
    );
  }
  const decidedAt = Date.now();
  const requests = [...ledger.requests];
  requests[requestIndex] = {
    ...request,
    state: mutation.decision,
    decidedAt
  };
  const grants = [...ledger.grants];
  if (mutation.decision === "approved" && request.scope === "session") {
    const duplicate = grants.some(grant =>
      grant.agentSnapshotFingerprint === request.agentSnapshotFingerprint
      && grant.contributionId === request.contributionId
      && grant.toolName === request.toolName
      && grant.sourcePolicyFingerprint === request.sourcePolicyFingerprint
      && grant.hostPolicyFingerprint === request.hostPolicyFingerprint
      && grant.currentPrincipalFingerprint
      === request.currentPrincipalFingerprint
      && grant.initiatorPrincipalFingerprint
      === request.initiatorPrincipalFingerprint);
    if (!duplicate) {
      const grant: RuntimeToolApprovalGrantSnapshot = {
        id: `approval-grant:${request.id}`,
        requestId: request.id,
        toolName: request.toolName,
        contributionId: request.contributionId,
        agentSnapshotFingerprint: request.agentSnapshotFingerprint,
        sourcePolicyFingerprint: request.sourcePolicyFingerprint,
        hostPolicyFingerprint: request.hostPolicyFingerprint,
        currentPrincipalFingerprint: request.currentPrincipalFingerprint,
        initiatorPrincipalFingerprint: request.initiatorPrincipalFingerprint,
        grantedAt: decidedAt
      };
      grants.push(grant);
    }
  }
  (snapshot as { approvalLedger?: RuntimeSessionSnapshot["approvalLedger"]; })
    .approvalLedger = { ...ledger, requests, grants };
  journal.push({
    type: "toolApprovalDecided",
    sequence: journal.length + 1,
    sessionVersion,
    requestId: request.id,
    runId: request.runId,
    decision: mutation.decision
  });
}

function _staleToolApproval({
  journal,
  mutation,
  sessionVersion,
  snapshot
}: {
  journal: RuntimeRunJournalEntry[];
  mutation: Extract<RuntimeSessionMutation, { type: "staleToolApproval"; }>;
  sessionVersion: number;
  snapshot: RuntimeSessionSnapshot;
}): void {
  const ledger = snapshot.approvalLedger;
  const requestIndex = ledger?.requests.findIndex(
    request => request.id === mutation.requestId
  ) ?? -1;
  const request = ledger?.requests[requestIndex];
  if (
    !ledger
    || request?.runId !== mutation.runId
    || (request.state !== "pending" && request.state !== "approved")
    || snapshot.activeRunId !== mutation.runId
  ) {
    throw new SessionStoreInvariantError(
      `Tool approval ${mutation.requestId} cannot become stale in Runtime Run ${mutation.runId}`
    );
  }
  const requests = [...ledger.requests];
  requests[requestIndex] = {
    ...request,
    state: "stale",
    decidedAt: Date.now()
  };
  (snapshot as { approvalLedger?: RuntimeSessionSnapshot["approvalLedger"]; })
    .approvalLedger = {
      ...ledger,
      requests,
      grants: ledger.grants.filter(grant => grant.requestId !== request.id)
    };
  journal.push({
    type: "toolApprovalStaled",
    sequence: journal.length + 1,
    sessionVersion,
    requestId: request.id,
    runId: request.runId
  });
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

function _renameBranch({
  journal,
  mutation,
  sessionVersion,
  snapshot
}: {
  journal: RuntimeRunJournalEntry[];
  mutation: Extract<RuntimeSessionMutation, { type: "renameBranch"; }>;
  sessionVersion: number;
  snapshot: RuntimeSessionSnapshot;
}): void {
  _assertId("Runtime branch", mutation.branchId);
  const label = mutation.label.trim();
  if (
    label.length === 0
    || label.length > MAX_RUNTIME_BRANCH_LABEL_LENGTH
  ) {
    throw new SessionStoreInvariantError(
      `Runtime branch labels must contain 1-${MAX_RUNTIME_BRANCH_LABEL_LENGTH} characters`
    );
  }
  const history = snapshot.history;
  const branchIndex = history.branches.findIndex(
    branch => branch.id === mutation.branchId
  );
  const branch = history.branches[branchIndex];
  if (!branch) {
    throw new SessionStoreInvariantError(
      `Runtime branch ${mutation.branchId} does not exist`
    );
  }
  const normalized = label.toLocaleLowerCase("en-US");
  if (history.branches.some(candidate =>
    candidate.id !== branch.id
    && candidate.label.toLocaleLowerCase("en-US") === normalized)) {
    throw new SessionStoreInvariantError(
      `Runtime branch label "${label}" already exists`
    );
  }
  if (branch.label === label) { return; }
  const branches = [...history.branches];
  branches[branchIndex] = { ...branch, label };
  _replaceHistory(snapshot, { ...history, branches });
  journal.push({
    type: "runtimeBranchRenamed",
    sequence: journal.length + 1,
    sessionVersion,
    branchId: branch.id,
    label
  });
}

function _recordCompaction({
  configurationById,
  journal,
  mutation,
  sessionVersion,
  snapshot
}: {
  configurationById: Map<string, RuntimeRunConfigurationSnapshot>;
  journal: RuntimeRunJournalEntry[];
  mutation: Extract<RuntimeSessionMutation, { type: "recordCompaction"; }>;
  sessionVersion: number;
  snapshot: RuntimeSessionSnapshot;
}): void {
  _assertId("Runtime Run", mutation.runId);
  _assertSha256(
    "Compaction request fingerprint",
    mutation.requestFingerprint
  );
  _assertSha256(
    "Compaction summary fingerprint",
    mutation.summaryFingerprint
  );
  if (mutation.summary.trim().length === 0) {
    throw new SessionStoreInvariantError(
      "Runtime compaction summary must not be empty"
    );
  }
  const numericEvidence = [
    mutation.contextWindow,
    mutation.tokensBefore,
    mutation.tokensAfter,
    mutation.usageTokens,
    mutation.trailingTokens
  ];
  if (
    numericEvidence.some(value => !Number.isSafeInteger(value) || value < 0)
    || mutation.contextWindow === 0
    || (
      mutation.lastUsageMessageIndex !== null
      && (
        !Number.isSafeInteger(mutation.lastUsageMessageIndex)
        || mutation.lastUsageMessageIndex < 0
      )
    )
  ) {
    throw new SessionStoreInvariantError(
      "Runtime compaction token evidence is invalid"
    );
  }
  const run = snapshot.runs.find(item => item.id === mutation.runId);
  if (run?.id !== snapshot.activeRunId) {
    throw new SessionStoreInvariantError(
      `Runtime Run ${mutation.runId} is not active for compaction`
    );
  }
  if (run.inputHeadEntryId === null) {
    throw new SessionStoreInvariantError(
      `Runtime Run ${run.id} has no messages to compact`
    );
  }
  const history = snapshot.history;
  if (history.compactions.some(item => item.runId === run.id)) {
    throw new SessionStoreInvariantError(
      `Runtime Run ${run.id} already recorded compaction`
    );
  }
  if (
    !runtimeEntryIsAncestor(
      history,
      mutation.firstKeptEntryId,
      run.inputHeadEntryId
    )
  ) {
    throw new SessionStoreInvariantError(
      `Compaction first-kept entry ${mutation.firstKeptEntryId} is not on Runtime Run ${run.id}`
    );
  }
  const compactionId = `${run.id}:compaction:1`;
  const configuration = configurationById.get(run.configurationId);
  if (!configuration) {
    throw new SessionStoreInvariantError(
      `Runtime Run ${run.id} configuration disappeared`
    );
  }
  const compaction = {
    id: compactionId,
    runId: run.id,
    branchId: run.branchId,
    sourceCheckpointId: run.baseCheckpointId,
    sourceHeadEntryId: run.inputHeadEntryId,
    firstKeptEntryId: mutation.firstKeptEntryId,
    summary: mutation.summary,
    summaryFingerprint: mutation.summaryFingerprint,
    requestFingerprint: mutation.requestFingerprint,
    model: configuration.model,
    contextWindow: mutation.contextWindow,
    tokenEvidence: {
      tokensBefore: mutation.tokensBefore,
      tokensAfter: mutation.tokensAfter,
      usageTokens: mutation.usageTokens,
      trailingTokens: mutation.trailingTokens,
      lastUsageMessageIndex: mutation.lastUsageMessageIndex
    },
    createdAt: Date.now()
  };
  _replaceHistory(snapshot, {
    ...history,
    compactions: [...history.compactions, compaction]
  });
  journal.push({
    type: "runtimeCompactionRecorded",
    sequence: journal.length + 1,
    sessionVersion,
    runId: run.id,
    branchId: run.branchId,
    compactionId,
    firstKeptEntryId: mutation.firstKeptEntryId,
    summaryFingerprint: mutation.summaryFingerprint
  });
}

async function _startRun({
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
}): Promise<void> {
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

  const history = snapshot.history;
  let branch: RuntimeBranchSnapshot;
  let createdBranch = false;
  let baseCheckpointId: string | null;
  if (history.branches.length === 0) {
    if (mutation.workingBase) {
      throw new SessionStoreInvariantError(
        "The first Runtime Run cannot select an existing checkpoint"
      );
    }
    branch = {
      id: "branch-1",
      ordinal: 1,
      label: "Main",
      parentCheckpointId: null,
      headCheckpointId: null,
      createdAt: Date.now()
    };
    baseCheckpointId = null;
    createdBranch = true;
  } else {
    const selectedBranchId = mutation.workingBase?.branchId
      ?? history.currentBranchId;
    const selected = history.branches.find(
      item => item.id === selectedBranchId
    );
    if (!selected) {
      throw new SessionStoreInvariantError(
        `Runtime working branch ${String(selectedBranchId)} does not exist`
      );
    }
    baseCheckpointId = mutation.workingBase?.checkpointId
      ?? history.currentCheckpointId;
    if (
      baseCheckpointId !== null
      && !runtimeBranchContainsCheckpoint(
        history,
        selected.id,
        baseCheckpointId
      )
    ) {
      throw new SessionStoreInvariantError(
        `Runtime checkpoint ${baseCheckpointId} is not on branch ${selected.id}`
      );
    }
    if (selected.headCheckpointId === baseCheckpointId) {
      branch = selected;
    } else {
      let ordinal = Math.max(
        1,
        ...history.branches.map(item => item.ordinal)
      ) + 1;
      const labels = new Set(
        history.branches.map(item => item.label.toLocaleLowerCase("en-US"))
      );
      while (labels.has(`branch ${ordinal}`.toLocaleLowerCase("en-US"))) {
        ordinal += 1;
      }
      branch = {
        id: `branch-${ordinal}`,
        ordinal,
        label: `Branch ${ordinal}`,
        parentCheckpointId: baseCheckpointId,
        headCheckpointId: baseCheckpointId,
        createdAt: Date.now()
      };
      createdBranch = true;
    }
  }

  const baseCheckpoint = baseCheckpointId === null
    ? null
    : history.checkpoints.find(item => item.id === baseCheckpointId);
  if (baseCheckpointId !== null && !baseCheckpoint) {
    throw new SessionStoreInvariantError(
      `Runtime Run ${mutation.runId} references missing base checkpoint ${baseCheckpointId}`
    );
  }
  const appended = await _appendRuntimeMessages({
    baseHeadEntryId: baseCheckpoint?.headEntryId ?? null,
    history,
    messages: mutation.messages,
    runId: mutation.runId
  });
  const branches = createdBranch
    ? [...history.branches, branch]
    : history.branches;
  _replaceHistory(snapshot, {
    ...history,
    branches,
    entries: appended.entries,
    currentBranchId: branch.id,
    currentCheckpointId: baseCheckpointId
  });

  const run: RuntimeRunSnapshot = {
    baseCheckpointId,
    branchId: branch.id,
    id: mutation.runId,
    inputHeadEntryId: appended.headEntryId,
    sessionId: snapshot.id,
    configurationId: mutation.configuration.id,
    state: "runningModel"
  };
  (snapshot.runs as RuntimeRunSnapshot[]).push(run);
  (snapshot as { activeRunId: string | null; }).activeRunId = run.id;
  if (createdBranch) {
    journal.push({
      type: "runtimeBranchCreated",
      sequence: journal.length + 1,
      sessionVersion,
      runId: run.id,
      branchId: branch.id,
      createdBranchId: branch.id,
      label: branch.label,
      ordinal: branch.ordinal,
      parentCheckpointId: branch.parentCheckpointId
    });
  }
  journal.push({
    type: "runtimeMessagesCommitted",
    sequence: journal.length + 1,
    sessionVersion,
    runId: run.id,
    branchId: branch.id,
    boundaryId: `${run.id}:input`,
    headEntryId: run.inputHeadEntryId,
    messageEntryIds: appended.appendedEntryIds
  });
  journal.push({
    type: "runStarted",
    sequence: journal.length + 1,
    sessionVersion,
    runId: run.id,
    branchId: run.branchId,
    baseCheckpointId: run.baseCheckpointId,
    inputHeadEntryId: run.inputHeadEntryId,
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

async function _recordCheckpoint({
  journal,
  mutation,
  sessionVersion,
  snapshot
}: {
  journal: RuntimeRunJournalEntry[];
  mutation: Extract<RuntimeSessionMutation, { type: "recordCheckpoint"; }>;
  sessionVersion: number;
  snapshot: RuntimeSessionSnapshot;
}): Promise<void> {
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
  const history = snapshot.history;
  const previousRunCheckpoint = history.checkpoints
    .filter(item => item.runId === run.id)
    .at(-1);
  const parentCheckpointId = previousRunCheckpoint?.id
    ?? run.baseCheckpointId;
  const appended = await _appendRuntimeMessages({
    baseHeadEntryId: previousRunCheckpoint?.headEntryId
      ?? run.inputHeadEntryId,
    history,
    messages: mutation.messages,
    runId: run.id
  });
  const checkpoint = {
    order: (run.checkpoint?.order ?? 0) + 1,
    state: run.state,
    continuationFingerprint: mutation.continuationFingerprint
  };
  (snapshot.runs as RuntimeRunSnapshot[])[runIndex] = {
    ...run,
    checkpoint
  };
  const historyCheckpoint = {
    id: `${run.id}:checkpoint:${checkpoint.order}`,
    runId: run.id,
    branchId: run.branchId,
    parentCheckpointId,
    headEntryId: appended.headEntryId,
    continuationFingerprint: checkpoint.continuationFingerprint,
    state: checkpoint.state,
    order: history.checkpoints.length + 1,
    createdAt: Date.now()
  };
  const branchIndex = history.branches.findIndex(
    branch => branch.id === run.branchId
  );
  const branch = history.branches[branchIndex];
  if (!branch) {
    throw new SessionStoreInvariantError(
      `Runtime Run ${run.id} references missing branch ${run.branchId}`
    );
  }
  const branches = [...history.branches];
  branches[branchIndex] = {
    ...branch,
    headCheckpointId: historyCheckpoint.id
  };
  _replaceHistory(snapshot, {
    ...history,
    branches,
    checkpoints: [...history.checkpoints, historyCheckpoint],
    entries: appended.entries,
    currentBranchId: run.branchId,
    currentCheckpointId: historyCheckpoint.id
  });
  if (run.state !== "waitingForApproval") {
    _checkpointActiveOperationSteps({
      journal,
      runId: run.id,
      sessionVersion,
      snapshot
    });
  }
  journal.push({
    type: "runtimeMessagesCommitted",
    sequence: journal.length + 1,
    sessionVersion,
    runId: run.id,
    branchId: run.branchId,
    boundaryId: historyCheckpoint.id,
    headEntryId: historyCheckpoint.headEntryId,
    messageEntryIds: appended.appendedEntryIds
  });
  journal.push({
    type: "runCheckpointRecorded",
    sequence: journal.length + 1,
    sessionVersion,
    runId: run.id,
    branchId: run.branchId,
    checkpointId: historyCheckpoint.id,
    parentCheckpointId: historyCheckpoint.parentCheckpointId,
    headEntryId: historyCheckpoint.headEntryId,
    ...checkpoint
  });
}

async function _appendRuntimeMessages(input: {
  readonly baseHeadEntryId: string | null;
  readonly history: RuntimeHistorySnapshot;
  readonly messages: readonly RuntimeJsonValue[];
  readonly runId: string;
}): Promise<{
  readonly appendedEntryIds: readonly string[];
  readonly entries: readonly RuntimeHistoryMessageEntrySnapshot[];
  readonly headEntryId: string | null;
}> {
  const prepared = await Promise.all(input.messages.map(async message => {
    const value = _runtimeJsonSnapshot(message);
    _assertRuntimeMessage(value);
    const canonical = _canonicalJson(value);
    return {
      canonical,
      fingerprint: await sha256(canonical),
      message: value
    };
  }));
  const basePath = runtimeHistoryMessagePath(
    input.history,
    input.baseHeadEntryId
  );
  let sharedCount = 0;
  while (sharedCount < basePath.length && sharedCount < prepared.length) {
    const previous = basePath[sharedCount];
    const next = prepared[sharedCount];
    if (!previous || !next) { break; }
    if (
      previous.fingerprint !== next.fingerprint
      || _canonicalJson(previous.message) !== next.canonical
    ) {
      break;
    }
    sharedCount += 1;
  }
  const entries = [...input.history.entries];
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  const appendedEntryIds: string[] = [];
  let parentId = sharedCount === 0
    ? null
    : basePath[sharedCount - 1]?.id ?? null;
  for (let index = sharedCount; index < prepared.length; index += 1) {
    const value = prepared[index];
    if (!value) {
      throw new SessionStoreInvariantError(
        "Runtime message preparation lost an entry"
      );
    }
    const id = `message-${await sha256(
      `${parentId ?? "root"}\n${value.fingerprint}`
    )}`;
    const existing = byId.get(id);
    if (existing) {
      if (
        existing.parentId !== parentId
        || existing.fingerprint !== value.fingerprint
        || _canonicalJson(existing.message) !== value.canonical
      ) {
        throw new SessionStoreInvariantError(
          `Runtime message entry ${id} has a content-address collision`
        );
      }
    } else {
      const entry: RuntimeHistoryMessageEntrySnapshot = {
        id,
        parentId,
        runId: input.runId,
        fingerprint: value.fingerprint,
        message: value.message,
        createdAt: Date.now()
      };
      entries.push(entry);
      byId.set(id, entry);
      appendedEntryIds.push(id);
    }
    parentId = id;
  }
  return {
    entries,
    appendedEntryIds,
    headEntryId: prepared.length === 0
      ? null
      : sharedCount === prepared.length
        ? basePath[prepared.length - 1]?.id ?? null
        : parentId
  };
}

function _runtimeJsonSnapshot(value: unknown): RuntimeJsonValue {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch (error) {
    throw new SessionStoreInvariantError(
      `Runtime history message is not serializable: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  if (serialized === undefined) {
    throw new SessionStoreInvariantError(
      "Runtime history message is not JSON data"
    );
  }
  return JSON.parse(serialized) as RuntimeJsonValue;
}

function _assertRuntimeMessage(
  message: RuntimeJsonValue
): void {
  if (
    !_isJsonValue(message, new WeakSet())
    || message === null
    || Array.isArray(message)
    || typeof message !== "object"
  ) {
    throw new SessionStoreInvariantError(
      "Runtime history messages must be JSON objects with a role"
    );
  }
  const role = (message as { readonly role?: unknown; }).role;
  if (typeof role !== "string" || role.trim().length === 0) {
    throw new SessionStoreInvariantError(
      "Runtime history messages must be JSON objects with a role"
    );
  }
}

function _replaceHistory(
  snapshot: RuntimeSessionSnapshot,
  history: RuntimeHistorySnapshot
): void {
  (snapshot as { history: RuntimeHistorySnapshot; }).history = history;
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

function _assertRuntimeHistory(
  session: StoredRuntimeSession,
  configurations: ReadonlyMap<string, RuntimeRunConfigurationSnapshot>
): void {
  const history = session.snapshot.history;
  if (history.schemaVersion !== RUNTIME_HISTORY_SCHEMA_VERSION) {
    throw new SessionStoreInvariantError(
      `Unsupported Runtime history schema: ${String(history.schemaVersion)}`
    );
  }
  const runs = new Map(session.snapshot.runs.map(run => [run.id, run]));
  const entries = new Map<string, RuntimeHistoryMessageEntrySnapshot>();
  for (const [index, entry] of history.entries.entries()) {
    _assertId("Runtime message entry", entry.id);
    _assertId("Runtime message Run", entry.runId);
    _assertSha256("Runtime message fingerprint", entry.fingerprint);
    _assertRuntimeTimestamp("Runtime message entry", entry.createdAt);
    _assertRuntimeMessage(entry.message);
    if (!runs.has(entry.runId)) {
      throw new SessionStoreInvariantError(
        `Runtime message entry ${entry.id} references missing Run ${entry.runId}`
      );
    }
    if (entries.has(entry.id)) {
      throw new SessionStoreInvariantError(
        `Runtime message entry ${entry.id} is duplicated`
      );
    }
    if (entry.parentId !== null) {
      const parentIndex = history.entries.findIndex(
        candidate => candidate.id === entry.parentId
      );
      if (parentIndex < 0 || parentIndex >= index) {
        throw new SessionStoreInvariantError(
          `Runtime message entry ${entry.id} has an invalid parent ${entry.parentId}`
        );
      }
    }
    entries.set(entry.id, entry);
  }

  const branchIds = new Set<string>();
  const branchOrdinals = new Set<number>();
  const branchLabels = new Set<string>();
  let previousOrdinal = 0;
  for (const [index, branch] of history.branches.entries()) {
    _assertId("Runtime branch", branch.id);
    _assertRuntimeTimestamp("Runtime branch", branch.createdAt);
    if (
      !Number.isSafeInteger(branch.ordinal)
      || branch.ordinal <= previousOrdinal
      || branch.ordinal < 1
    ) {
      throw new SessionStoreInvariantError(
        `Runtime branch ${branch.id} has invalid creation ordinal`
      );
    }
    previousOrdinal = branch.ordinal;
    const label = branch.label.trim();
    const normalizedLabel = label.toLocaleLowerCase("en-US");
    if (
      label !== branch.label
      || label.length === 0
      || label.length > MAX_RUNTIME_BRANCH_LABEL_LENGTH
      || branchIds.has(branch.id)
      || branchOrdinals.has(branch.ordinal)
      || branchLabels.has(normalizedLabel)
    ) {
      throw new SessionStoreInvariantError(
        `Runtime branch ${branch.id} has invalid identity or label`
      );
    }
    if (
      index === 0
      && (
        branch.id !== "branch-1"
        || branch.ordinal !== 1
        || branch.parentCheckpointId !== null
      )
    ) {
      throw new SessionStoreInvariantError(
        "The first Runtime branch must be branch-1 at the root"
      );
    }
    branchIds.add(branch.id);
    branchOrdinals.add(branch.ordinal);
    branchLabels.add(normalizedLabel);
  }

  const checkpointIds = new Set<string>();
  const checkpointsByRun = new Map<string, RuntimeCheckpointSnapshot[]>();
  for (const [index, checkpoint] of history.checkpoints.entries()) {
    _assertId("Runtime checkpoint", checkpoint.id);
    _assertId("Runtime checkpoint branch", checkpoint.branchId);
    _assertId("Runtime checkpoint Run", checkpoint.runId);
    _assertId(
      "Runtime checkpoint continuation",
      checkpoint.continuationFingerprint
    );
    _assertRuntimeTimestamp("Runtime checkpoint", checkpoint.createdAt);
    if (
      checkpoint.order !== index + 1
      || checkpointIds.has(checkpoint.id)
      || !CHECKPOINT_STATES.has(checkpoint.state)
    ) {
      throw new SessionStoreInvariantError(
        `Runtime checkpoint ${checkpoint.id} has invalid identity or order`
      );
    }
    const run = runs.get(checkpoint.runId);
    if (run?.branchId !== checkpoint.branchId) {
      throw new SessionStoreInvariantError(
        `Runtime checkpoint ${checkpoint.id} does not match its Run branch`
      );
    }
    if (
      checkpoint.headEntryId !== null
      && !entries.has(checkpoint.headEntryId)
    ) {
      throw new SessionStoreInvariantError(
        `Runtime checkpoint ${checkpoint.id} references missing message head ${checkpoint.headEntryId}`
      );
    }
    if (
      checkpoint.parentCheckpointId !== null
      && !checkpointIds.has(checkpoint.parentCheckpointId)
    ) {
      throw new SessionStoreInvariantError(
        `Runtime checkpoint ${checkpoint.id} references a missing or later parent`
      );
    }
    const runCheckpoints = checkpointsByRun.get(run.id) ?? [];
    const expectedParent = runCheckpoints.at(-1)?.id ?? run.baseCheckpointId;
    const expectedId = `${run.id}:checkpoint:${runCheckpoints.length + 1}`;
    if (
      checkpoint.parentCheckpointId !== expectedParent
      || checkpoint.id !== expectedId
    ) {
      throw new SessionStoreInvariantError(
        `Runtime checkpoint ${checkpoint.id} does not extend Run ${run.id}`
      );
    }
    runCheckpoints.push(checkpoint);
    checkpointsByRun.set(run.id, runCheckpoints);
    checkpointIds.add(checkpoint.id);
  }

  for (const branch of history.branches) {
    if (
      branch.parentCheckpointId !== null
      && !checkpointIds.has(branch.parentCheckpointId)
    ) {
      throw new SessionStoreInvariantError(
        `Runtime branch ${branch.id} references missing parent checkpoint ${branch.parentCheckpointId}`
      );
    }
    if (
      branch.headCheckpointId !== null
      && !checkpointIds.has(branch.headCheckpointId)
    ) {
      throw new SessionStoreInvariantError(
        `Runtime branch ${branch.id} references missing head checkpoint ${branch.headCheckpointId}`
      );
    }
    if (
      branch.parentCheckpointId !== null
      && (
        branch.headCheckpointId === null
        || !runtimeHistoryCheckpointPath(history, branch.headCheckpointId)
          .some(checkpoint => checkpoint.id === branch.parentCheckpointId)
      )
    ) {
      throw new SessionStoreInvariantError(
        `Runtime branch ${branch.id} head does not descend from its parent checkpoint`
      );
    }
  }

  for (const run of runs.values()) {
    const branch = history.branches.find(item => item.id === run.branchId);
    if (!branch) {
      throw new SessionStoreInvariantError(
        `Runtime Run ${run.id} references missing branch ${run.branchId}`
      );
    }
    if (
      run.baseCheckpointId !== null
      && !runtimeBranchContainsCheckpoint(
        history,
        branch.id,
        run.baseCheckpointId
      )
    ) {
      throw new SessionStoreInvariantError(
        `Runtime Run ${run.id} base is outside branch ${branch.id}`
      );
    }
    if (
      run.inputHeadEntryId !== null
      && !entries.has(run.inputHeadEntryId)
    ) {
      throw new SessionStoreInvariantError(
        `Runtime Run ${run.id} references missing input message head ${run.inputHeadEntryId}`
      );
    }
    const runCheckpoints = checkpointsByRun.get(run.id) ?? [];
    const latest = runCheckpoints.at(-1);
    if (
      (run.checkpoint === undefined) !== (latest === undefined)
      || (
        run.checkpoint
        && latest
        && (
          run.checkpoint.order !== runCheckpoints.length
          || run.checkpoint.state !== latest.state
          || run.checkpoint.continuationFingerprint
          !== latest.continuationFingerprint
        )
      )
    ) {
      throw new SessionStoreInvariantError(
        `Runtime Run ${run.id} checkpoint does not match immutable history`
      );
    }
  }

  const compactionIds = new Set<string>();
  const compactedRuns = new Set<string>();
  for (const compaction of history.compactions) {
    _assertId("Runtime compaction", compaction.id);
    _assertId("Runtime compaction Run", compaction.runId);
    _assertId("Runtime compaction branch", compaction.branchId);
    _assertSha256(
      "Runtime compaction summary fingerprint",
      compaction.summaryFingerprint
    );
    _assertSha256(
      "Runtime compaction request fingerprint",
      compaction.requestFingerprint
    );
    _assertRuntimeTimestamp("Runtime compaction", compaction.createdAt);
    const run = runs.get(compaction.runId);
    const configuration = run
      ? configurations.get(run.configurationId)
      : undefined;
    if (
      !run
      || !configuration
      || run.branchId !== compaction.branchId
      || run.inputHeadEntryId !== compaction.sourceHeadEntryId
      || run.baseCheckpointId !== compaction.sourceCheckpointId
      || configuration.model.provider !== compaction.model.provider
      || configuration.model.id !== compaction.model.id
      || compaction.id !== `${run.id}:compaction:1`
      || compactionIds.has(compaction.id)
      || compactedRuns.has(run.id)
      || compaction.summary.trim().length === 0
      || new TextEncoder().encode(compaction.summary).byteLength
      > MAX_DURABLE_OPERATION_REPLAY_BYTES
      || !runtimeEntryIsAncestor(
        history,
        compaction.firstKeptEntryId,
        compaction.sourceHeadEntryId
      )
    ) {
      throw new SessionStoreInvariantError(
        `Runtime compaction ${compaction.id} has invalid lineage or identity`
      );
    }
    const evidence = compaction.tokenEvidence;
    if (
      !Number.isSafeInteger(compaction.contextWindow)
      || compaction.contextWindow < 1
      || [
        evidence.tokensBefore,
        evidence.tokensAfter,
        evidence.usageTokens,
        evidence.trailingTokens
      ].some(value => !Number.isSafeInteger(value) || value < 0)
      || (
        evidence.lastUsageMessageIndex !== null
        && (
          !Number.isSafeInteger(evidence.lastUsageMessageIndex)
          || evidence.lastUsageMessageIndex < 0
        )
      )
    ) {
      throw new SessionStoreInvariantError(
        `Runtime compaction ${compaction.id} has invalid token evidence`
      );
    }
    compactionIds.add(compaction.id);
    compactedRuns.add(run.id);
  }

  if (history.branches.length === 0) {
    if (
      history.currentBranchId !== null
      || history.currentCheckpointId !== null
      || history.checkpoints.length > 0
      || history.entries.length > 0
      || history.compactions.length > 0
    ) {
      throw new SessionStoreInvariantError(
        "An empty Runtime history cannot retain current pointers or entries"
      );
    }
  } else {
    const currentBranch = history.branches.find(
      branch => branch.id === history.currentBranchId
    );
    if (
      currentBranch?.headCheckpointId !== history.currentCheckpointId
    ) {
      throw new SessionStoreInvariantError(
        "Runtime history current branch and checkpoint do not match"
      );
    }
  }
}

async function _assertRuntimeHistoryIntegrity(
  history: RuntimeHistorySnapshot
): Promise<void> {
  for (const entry of history.entries) {
    const fingerprint = await sha256(_canonicalJson(entry.message));
    const id = `message-${await sha256(
      `${entry.parentId ?? "root"}\n${fingerprint}`
    )}`;
    if (entry.fingerprint !== fingerprint || entry.id !== id) {
      throw new SessionStoreInvariantError(
        `Runtime message entry ${entry.id} content fingerprint does not match`
      );
    }
  }
  for (const compaction of history.compactions) {
    if (compaction.summaryFingerprint !== await sha256(compaction.summary)) {
      throw new SessionStoreInvariantError(
        `Runtime compaction ${compaction.id} summary fingerprint does not match`
      );
    }
  }
}

function _assertRuntimeTimestamp(label: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new SessionStoreInvariantError(`${label} has an invalid timestamp`);
  }
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

function _assertApprovalLedger(snapshot: RuntimeSessionSnapshot): void {
  const ledger = snapshot.approvalLedger;
  if (!ledger) { return; }
  if (ledger.schemaVersion !== RUNTIME_TOOL_APPROVAL_LEDGER_SCHEMA_VERSION) {
    throw new SessionStoreInvariantError(
      `Unsupported tool approval ledger schema: ${String(ledger.schemaVersion)}`
    );
  }
  const requestIds = new Set<string>();
  const grantIdentities = new Set<string>();
  const operations = new Map(
    (snapshot.operationLedger?.steps ?? []).flatMap(step =>
      step.operations.map(operation => [operation.id, operation] as const))
  );
  for (const request of ledger.requests) {
    _assertId("Tool approval", request.id);
    _assertId("Runtime Run", request.runId);
    _assertId("Durable Step", request.stepId);
    _assertId("Durable operation", request.operationId);
    _assertId("Approval tool call", request.toolCallId);
    _assertId("Approval tool name", request.toolName);
    _assertId("Approval contribution", request.contributionId);
    _assertId("Agent snapshot fingerprint", request.agentSnapshotFingerprint);
    for (const [label, value] of [
      ["Approval request fingerprint", request.requestFingerprint],
      ["Approval source-policy fingerprint", request.sourcePolicyFingerprint],
      ["Approval Host-policy fingerprint", request.hostPolicyFingerprint],
      ["Approval current-principal fingerprint", request.currentPrincipalFingerprint],
      ["Approval initiator-principal fingerprint", request.initiatorPrincipalFingerprint]
    ] as const) {
      _assertSha256(label, value);
    }
    if (requestIds.has(request.id)) {
      throw new SessionStoreInvariantError(
        `Tool approval ${request.id} is duplicated`
      );
    }
    requestIds.add(request.id);
    if (
      !APPROVAL_REQUEST_STATES.has(request.state)
      || !["always", "deny", "never", "once"].includes(
        request.sourceRequirement
      )
      || !["always", "deny", "never", "once"].includes(
        request.hostRequirement
      )
      || (request.scope !== "call" && request.scope !== "session")
      || !Number.isSafeInteger(request.requestedAt)
      || request.requestedAt < 0
      || (request.reason !== undefined
        && (request.reason.trim().length === 0 || request.reason.length > 1_024))
    ) {
      throw new SessionStoreInvariantError(
        `Tool approval ${request.id} has invalid state or metadata`
      );
    }
    const decided = request.state !== "pending";
    if (
      decided !== Number.isSafeInteger(request.decidedAt)
      || (request.decidedAt !== undefined
        && request.decidedAt < request.requestedAt)
    ) {
      throw new SessionStoreInvariantError(
        `Tool approval ${request.id} has invalid decision metadata`
      );
    }
    const operation = operations.get(request.operationId);
    if (
      operation?.runId !== request.runId
      || operation.stepId !== request.stepId
      || operation.toolCallId !== request.toolCallId
      || operation.requestFingerprint !== request.requestFingerprint
    ) {
      throw new SessionStoreInvariantError(
        `Tool approval ${request.id} does not match its durable operation`
      );
    }
  }
  for (const grant of ledger.grants) {
    _assertId("Tool approval grant", grant.id);
    _assertId("Approval grant request", grant.requestId);
    _assertId("Approval grant tool name", grant.toolName);
    _assertId("Approval grant contribution", grant.contributionId);
    _assertId("Agent snapshot fingerprint", grant.agentSnapshotFingerprint);
    for (const [label, value] of [
      ["Approval grant source-policy fingerprint", grant.sourcePolicyFingerprint],
      ["Approval grant Host-policy fingerprint", grant.hostPolicyFingerprint],
      ["Approval grant current-principal fingerprint", grant.currentPrincipalFingerprint],
      ["Approval grant initiator-principal fingerprint", grant.initiatorPrincipalFingerprint]
    ] as const) {
      _assertSha256(label, value);
    }
    if (!Number.isSafeInteger(grant.grantedAt) || grant.grantedAt < 0) {
      throw new SessionStoreInvariantError(
        `Tool approval grant ${grant.id} has invalid timestamp`
      );
    }
    const request = ledger.requests.find(item => item.id === grant.requestId);
    if (
      request?.state !== "approved"
      || request.scope !== "session"
      || request.toolName !== grant.toolName
      || request.contributionId !== grant.contributionId
      || request.agentSnapshotFingerprint !== grant.agentSnapshotFingerprint
      || request.sourcePolicyFingerprint !== grant.sourcePolicyFingerprint
      || request.hostPolicyFingerprint !== grant.hostPolicyFingerprint
      || request.currentPrincipalFingerprint
      !== grant.currentPrincipalFingerprint
      || request.initiatorPrincipalFingerprint
      !== grant.initiatorPrincipalFingerprint
    ) {
      throw new SessionStoreInvariantError(
        `Tool approval grant ${grant.id} does not match an approved Session request`
      );
    }
    const identity = [
      grant.agentSnapshotFingerprint,
      grant.contributionId,
      grant.toolName,
      grant.sourcePolicyFingerprint,
      grant.hostPolicyFingerprint,
      grant.currentPrincipalFingerprint,
      grant.initiatorPrincipalFingerprint
    ].join("\u0000");
    if (grantIdentities.has(identity)) {
      throw new SessionStoreInvariantError(
        `Tool approval grant ${grant.id} duplicates an existing identity`
      );
    }
    grantIdentities.add(identity);
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
    if (
      tool.approval !== undefined
      && !isApprovalRequirement(tool.approval)
    ) {
      throw new SessionStoreInvariantError(
        `Tool ${tool.name} has an invalid approval requirement`
      );
    }
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
  _assertApprovalLedger(session.snapshot);
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
    _assertId("Runtime branch", run.branchId);
    if (run.baseCheckpointId !== null) {
      _assertId("Runtime base checkpoint", run.baseCheckpointId);
    }
    if (run.inputHeadEntryId !== null) {
      _assertId("Runtime input message head", run.inputHeadEntryId);
    }
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
  _assertRuntimeHistory(session, configurations);

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
    if (entry.type === "runtimeBranchRenamed") {
      const branch = session.snapshot.history.branches.find(
        item => item.id === entry.branchId
      );
      if (branch?.label !== entry.label) {
        throw new SessionStoreInvariantError(
          `Runtime branch rename journal entry ${entry.sequence} is invalid`
        );
      }
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
    baseCheckpointId: string | null;
    branchId: string;
    checkpoint?: RuntimeRunSnapshot["checkpoint"];
    configurationId: string;
    inputHeadEntryId: string | null;
    state: RuntimeRunState;
  }>();
  for (const entry of session.journal) {
    if (
      entry.type === "sessionStateReplaced"
      || entry.type === "turnInstructionsRecorded"
      || entry.type === "turnCapabilitiesRecorded"
      || entry.type === "runtimeBranchRenamed"
    ) { continue; }
    if (
      entry.type === "operationStarted"
      || entry.type === "operationSettled"
      || entry.type === "operationStepCheckpointed"
      || entry.type === "operationResumed"
      || entry.type === "toolApprovalRequested"
      || entry.type === "toolApprovalDecided"
      || entry.type === "toolApprovalStaled"
      || entry.type === "runtimeBranchCreated"
      || entry.type === "runtimeMessagesCommitted"
      || entry.type === "runtimeCompactionRecorded"
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
        baseCheckpointId: entry.baseCheckpointId,
        branchId: entry.branchId,
        configurationId: entry.configurationId,
        inputHeadEntryId: entry.inputHeadEntryId,
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
          baseCheckpointId: current.baseCheckpointId,
          branchId: current.branchId,
          id: entry.runId,
          inputHeadEntryId: current.inputHeadEntryId,
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
      || reconstructed.branchId !== run.branchId
      || reconstructed.baseCheckpointId !== run.baseCheckpointId
      || reconstructed.inputHeadEntryId !== run.inputHeadEntryId
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
