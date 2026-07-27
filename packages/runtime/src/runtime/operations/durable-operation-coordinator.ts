import type { AssistantMessage } from "@earendil-works/pi-ai";

import {
  MAX_DURABLE_OPERATION_REPLAY_BYTES,
  MAX_DURABLE_STEP_REPLAY_BYTES,
  type RuntimeDurableOperationReplayEnvelope,
  type RuntimeDurableOperationSnapshot,
  type RuntimeDurableStepSnapshot
} from "../harness/durable-operation";
import { DurableOperationFingerprintMismatchError } from "../harness/durable-operation-fingerprint-mismatch-error";
import { DurableOperationOutcomeUnknownError } from "../harness/durable-operation-outcome-unknown-error";
import { DurableOperationParkedError } from "../harness/durable-operation-parked-error";
import {
  type DurableOperationResumeClaim,
  resumeDurableOperation
} from "../harness/durable-operation-resume";
import { sha256 } from "../harness/sha256";
import { RuntimeRunLimitExceededError } from "../limits/runtime-run-limit-exceeded-error";

import type { PreparedAgentTool } from "../agent/prepared-agent-tool";
import type { RuntimeJsonValue } from "../harness/runtime-run";
import type {
  RuntimeSessionMutation,
  SessionStore,
  StoredRuntimeSession
} from "../harness/session-store";

export type DurableOperationBeginResult =
  | {
    readonly operation: RuntimeDurableOperationSnapshot;
    readonly type: "dispatch";
  }
  | {
    readonly operation: RuntimeDurableOperationSnapshot;
    readonly type: "replay";
    readonly value: RuntimeJsonValue;
  };

interface PendingToolSettlement {
  readonly mutation: Extract<
    RuntimeSessionMutation,
    { type: "settleOperation"; }
  >;
  readonly unknown: boolean;
}

export class DurableOperationCoordinator {
  private readonly _sessionStore?: SessionStore;
  private readonly _sessionId: string;
  private readonly _runId: string;
  private readonly _onCommitted?: (
    session: StoredRuntimeSession
  ) => Promise<void> | void;

  private _commitTail: Promise<void> = Promise.resolve();
  private _runDurabilityActive: boolean;
  private _activeStepId: string | null = null;
  private readonly _pendingTools = new Map<string, PendingToolSettlement>();
  private readonly _preparedTools = new Map<
    string,
    DurableOperationBeginResult
  >();

  private readonly _resumedToolFingerprints = new Map<string, string>();

  constructor(options: {
    readonly onCommitted?: (
      session: StoredRuntimeSession
    ) => Promise<void> | void;
    readonly runId: string;
    readonly sessionId: string;
    readonly sessionStore?: SessionStore;
  }) {
    this._sessionStore = options.sessionStore;
    this._sessionId = options.sessionId;
    this._runId = options.runId;
    this._onCommitted = options.onCommitted;
    this._runDurabilityActive = Boolean(options.sessionStore);
  }

  get enabled(): boolean {
    return Boolean(this._sessionStore);
  }

  get active(): boolean {
    return this._runDurabilityActive;
  }

  async beginProvider(input: {
    readonly provider: string;
    readonly request: unknown;
    readonly transcriptMessageCount?: number;
  }): Promise<DurableOperationBeginResult | null> {
    if (!this._sessionStore) { return null; }
    const current = await this._sessionStore.load(this._sessionId);
    if (current?.snapshot.activeRunId !== this._runId) {
      this._runDurabilityActive = false;
      return null;
    }
    this._runDurabilityActive = true;
    const requestFingerprint = await fingerprintDurableOperationValue(
      input.request
    );
    return this._serialize(async () => this._begin({
      kind: "provider",
      provider: input.provider,
      requestFingerprint,
      transcriptMessageCount: input.transcriptMessageCount ?? 0
    }));
  }

  async settleProvider(input: {
    readonly mainProviderUsage?: {
      readonly input: number;
      readonly metered: boolean;
      readonly output: number;
    };
    readonly operation: RuntimeDurableOperationSnapshot;
    readonly state: "completed" | "failed";
    readonly value: unknown;
  }): Promise<void> {
    if (!this._sessionStore) { return; }
    let replay: RuntimeDurableOperationReplayEnvelope;
    try {
      replay = await createDurableOperationReplayEnvelope(input.value);
      await this._assertStepReplayLimit(input.operation.stepId, replay.byteLength);
    } catch (error) {
      await this.markOutcomeUnknown(input.operation);
      throw new DurableOperationOutcomeUnknownError(
        input.operation.id,
        error instanceof Error ? error.message : String(error)
      );
    }
    try {
      await this._commit([{
        type: "settleOperation",
        runId: this._runId,
        operationId: input.operation.id,
        requestFingerprint: input.operation.requestFingerprint,
        state: input.state,
        replay,
        ...(input.mainProviderUsage
          ? { mainProviderUsage: input.mainProviderUsage }
          : {})
      }]);
    } catch (error) {
      try {
        await this.markOutcomeUnknown(input.operation);
      } catch {
        // Recovery will classify the durable pre-call if persistence is down.
      }
      throw new DurableOperationOutcomeUnknownError(
        input.operation.id,
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  async completeAuxiliaryProvider(input: {
    readonly execute: () => Promise<AssistantMessage>;
    readonly provider: string;
    readonly request: unknown;
    readonly signal?: AbortSignal;
    readonly slot: string;
    readonly transcriptMessageCount: number;
  }): Promise<AssistantMessage> {
    if (!this._sessionStore) { return input.execute(); }
    const current = await this._sessionStore.load(this._sessionId);
    if (current?.snapshot.activeRunId !== this._runId) {
      throw new Error(
        `Runtime Run ${this._runId} is not active for auxiliary provider work`
      );
    }
    const requestFingerprint = await fingerprintDurableOperationValue(
      input.request
    );
    const begun = await this._serialize(async () => this._begin({
      kind: "provider",
      provider: input.provider,
      providerSlot: input.slot,
      requestFingerprint,
      transcriptMessageCount: input.transcriptMessageCount
    }));
    if (begun.type === "replay") {
      return _replayProviderMessage(begun.operation, begun.value);
    }
    if (input.signal?.aborted) {
      await this.markCancelled(begun.operation);
      const error = new Error("Auxiliary provider operation cancelled before dispatch");
      error.name = "AbortError";
      throw error;
    }
    let message: AssistantMessage;
    try {
      message = await input.execute();
    } catch (error) {
      try {
        await this.markOutcomeUnknown(begun.operation);
      } catch {}
      throw new DurableOperationOutcomeUnknownError(
        begun.operation.id,
        error instanceof Error ? error.message : String(error)
      );
    }
    if (message.stopReason === "aborted") {
      await this.markOutcomeUnknown(begun.operation);
      throw new DurableOperationOutcomeUnknownError(
        begun.operation.id,
        `Auxiliary provider operation ${begun.operation.id} was aborted after possible dispatch`
      );
    }
    await this.settleProvider({
      operation: begun.operation,
      state: message.stopReason === "error" ? "failed" : "completed",
      value: { type: "providerMessage", message }
    });
    return message;
  }

  async markOutcomeUnknown(
    operation: RuntimeDurableOperationSnapshot
  ): Promise<void> {
    if (!this._sessionStore || operation.state !== "preCall") { return; }
    await this._commit([{
      type: "settleOperation",
      runId: this._runId,
      operationId: operation.id,
      requestFingerprint: operation.requestFingerprint,
      state: "outcomeUnknown"
    }]);
  }

  async markCancelled(
    operation: RuntimeDurableOperationSnapshot
  ): Promise<void> {
    if (!this._sessionStore || operation.state !== "preCall") { return; }
    await this._commit([{
      type: "settleOperation",
      runId: this._runId,
      operationId: operation.id,
      requestFingerprint: operation.requestFingerprint,
      state: "cancelled"
    }]);
  }

  wrapTool(tool: PreparedAgentTool): PreparedAgentTool {
    if (!this._sessionStore || tool.kind !== "executable") { return tool; }
    return {
      ...tool,
      execute: async (...args) => {
        if (!this._runDurabilityActive) {
          return tool.execute(...args);
        }
        const [toolCallId, value, signal] = args;
        const begun = this._preparedTools.get(toolCallId)
          ?? await this.prepareToolCall({
            arguments: value,
            name: tool.definition.name,
            toolCallId
          });
        const resumedFingerprint = this._resumedToolFingerprints.get(toolCallId);
        if (resumedFingerprint) {
          const actualFingerprint = await fingerprintDurableOperationValue({
            name: tool.definition.name,
            arguments: value
          });
          if (actualFingerprint !== resumedFingerprint) {
            this._preparedTools.delete(toolCallId);
            this._resumedToolFingerprints.delete(toolCallId);
            await this.markCancelled(begun.operation);
            throw new DurableOperationFingerprintMismatchError(
              begun.operation.id
            );
          }
          this._resumedToolFingerprints.delete(toolCallId);
        }
        this._preparedTools.delete(toolCallId);
        if (begun.type === "replay") {
          return _replayToolOutcome(begun.operation, begun.value);
        }
        let outcome;
        try {
          outcome = await tool.execute(...args);
        } catch (error) {
          if (
            error instanceof DurableOperationOutcomeUnknownError
            || signal?.aborted
          ) {
            await this._queueToolSettlement({
              operation: begun.operation,
              state: "outcomeUnknown"
            });
            throw error instanceof DurableOperationOutcomeUnknownError
              ? error
              : new DurableOperationOutcomeUnknownError(begun.operation.id);
          }
          let replay: RuntimeDurableOperationReplayEnvelope;
          try {
            replay = await createDurableOperationReplayEnvelope({
              type: "toolError",
              error: {
                name: error instanceof Error ? error.name : "Error",
                message: error instanceof Error ? error.message : String(error)
              }
            });
          } catch {
            await this._queueToolSettlement({
              operation: begun.operation,
              state: "outcomeUnknown"
            });
            throw new DurableOperationOutcomeUnknownError(begun.operation.id);
          }
          await this._queueToolSettlement({
            operation: begun.operation,
            replay,
            state: "failed"
          });
          throw error;
        }
        let replay: RuntimeDurableOperationReplayEnvelope;
        try {
          replay = await createDurableOperationReplayEnvelope({
            type: "toolOutcome",
            outcome
          });
        } catch {
          await this._queueToolSettlement({
            operation: begun.operation,
            state: "outcomeUnknown"
          });
          throw new DurableOperationOutcomeUnknownError(begun.operation.id);
        }
        await this._queueToolSettlement({
          operation: begun.operation,
          replay,
          state: outcome.type === "completed" && outcome.result.isError === true
            ? "failed"
            : "completed"
        });
        return outcome;
      }
    };
  }

  async prepareToolCall(input: {
    readonly arguments: unknown;
    readonly name: string;
    readonly toolCallId: string;
  }): Promise<DurableOperationBeginResult> {
    const existing = this._preparedTools.get(input.toolCallId);
    if (existing) { return existing; }
    const begun = await this._serialize(async () => this._begin({
      kind: "tool",
      requestFingerprint: await fingerprintDurableOperationValue({
        name: input.name,
        arguments: input.arguments
      }),
      toolCallId: input.toolCallId
    }));
    this._preparedTools.set(input.toolCallId, begun);
    return begun;
  }

  async parkToolCallForApproval(input: {
    readonly agentSnapshotFingerprint: string;
    readonly arguments: unknown;
    readonly contributionId: string;
    readonly currentPrincipalFingerprint: string;
    readonly denied?: boolean;
    readonly hostPolicyFingerprint: string;
    readonly hostRequirement: "always" | "deny" | "never" | "once";
    readonly initiatorPrincipalFingerprint: string;
    readonly name: string;
    readonly reason?: string;
    readonly scope: "call" | "session";
    readonly sourcePolicyFingerprint: string;
    readonly sourceRequirement: "always" | "deny" | "never" | "once";
    readonly toolCallId: string;
  }): Promise<RuntimeDurableOperationSnapshot> {
    return this._serialize(async () => {
      const store = this._requiredStore();
      const current = await store.load(this._sessionId);
      if (current?.snapshot.activeRunId !== this._runId) {
        throw new Error(
          `Runtime Run ${this._runId} is not active in Session ${this._sessionId}`
        );
      }
      const step = _activeStep(current, this._runId);
      if (!step) {
        throw new Error(
          `Tool ${input.toolCallId} has no active durable provider Step`
        );
      }
      this._activeStepId = step.id;
      const operationId = `${step.id}:tool:${input.toolCallId}`;
      const requestId = `approval:${operationId}`;
      const requestFingerprint = await fingerprintDurableOperationValue({
        name: input.name,
        arguments: input.arguments
      });
      const existing = step.operations.find(operation =>
        operation.id === operationId);
      if (existing) {
        await this._existing(existing, requestFingerprint);
        throw new Error(`Durable operation ${operationId} is not parked`);
      }
      const resumeSchemaFingerprint = await fingerprintDurableOperationValue({
        type: "toolApprovalResume",
        version: 1
      });
      const mutations: RuntimeSessionMutation[] = [
        {
          type: "startOperation",
          runId: this._runId,
          stepId: step.id,
          stepSequence: step.sequence,
          transcriptMessageCount: step.transcriptMessageCount,
          operationId,
          kind: "tool",
          toolCallId: input.toolCallId,
          requestFingerprint,
          park: {
            parkId: requestId,
            reason: input.reason ?? "Tool approval required",
            resumeSchemaFingerprint
          }
        },
        {
          type: "requestToolApproval",
          requestId,
          runId: this._runId,
          stepId: step.id,
          operationId,
          toolCallId: input.toolCallId,
          toolName: input.name,
          contributionId: input.contributionId,
          requestFingerprint,
          agentSnapshotFingerprint: input.agentSnapshotFingerprint,
          sourcePolicyFingerprint: input.sourcePolicyFingerprint,
          sourceRequirement: input.sourceRequirement,
          hostRequirement: input.hostRequirement,
          hostPolicyFingerprint: input.hostPolicyFingerprint,
          currentPrincipalFingerprint: input.currentPrincipalFingerprint,
          initiatorPrincipalFingerprint: input.initiatorPrincipalFingerprint,
          scope: input.scope,
          ...(input.reason ? { reason: input.reason } : {})
        }
      ];
      if (input.denied) {
        mutations.push(
          {
            type: "decideToolApproval",
            requestId,
            runId: this._runId,
            currentPrincipalFingerprint: input.currentPrincipalFingerprint,
            initiatorPrincipalFingerprint: input.initiatorPrincipalFingerprint,
            decision: "denied"
          },
          {
            type: "resumeOperation",
            runId: this._runId,
            operationId,
            parkId: requestId,
            requestFingerprint,
            resumeSchemaFingerprint
          },
          {
            type: "settleOperation",
            runId: this._runId,
            operationId,
            requestFingerprint,
            state: "cancelled"
          }
        );
      }
      const committed = await store.commit({
        sessionId: this._sessionId,
        expectedVersion: current.version,
        mutations
      });
      await this._onCommitted?.(committed);
      return _requiredOperation(committed, operationId);
    });
  }

  async resumeParkedOperation(
    claim: Omit<DurableOperationResumeClaim, "requestFingerprint">,
    input: {
      readonly arguments: unknown;
      readonly name: string;
    }
  ): Promise<Extract<DurableOperationBeginResult, { type: "dispatch"; }>> {
    if (
      claim.sessionId !== this._sessionId
      || claim.runId !== this._runId
    ) {
      throw new Error("Durable operation resume claim is outside coordinator scope");
    }
    return this._serialize(async () => {
      const requestFingerprint = await fingerprintDurableOperationValue({
        name: input.name,
        arguments: input.arguments
      });
      const resumed = await resumeDurableOperation(
        this._requiredStore(),
        { ...claim, requestFingerprint }
      );
      await this._onCommitted?.(resumed);
      const operation = _requiredOperation(resumed, claim.operationId);
      if (operation.state !== "preCall") {
        throw new Error(
          `Resumed durable operation ${operation.id} is not ready to dispatch`
        );
      }
      this._activeStepId = operation.stepId;
      const result = { type: "dispatch" as const, operation };
      if (operation.kind === "tool" && operation.toolCallId) {
        this._preparedTools.set(operation.toolCallId, result);
        this._resumedToolFingerprints.set(
          operation.toolCallId,
          requestFingerprint
        );
      }
      return result;
    });
  }

  async cancelParkedToolCall(input: {
    readonly operationId: string;
    readonly parkId: string;
    readonly requestFingerprint: string;
    readonly resumeSchemaFingerprint: string;
  }): Promise<RuntimeDurableOperationSnapshot> {
    return this._serialize(async () => {
      const store = this._requiredStore();
      const current = await store.load(this._sessionId);
      if (current?.snapshot.activeRunId !== this._runId) {
        throw new Error(
          `Runtime Run ${this._runId} is not active in Session ${this._sessionId}`
        );
      }
      const committed = await store.commit({
        sessionId: this._sessionId,
        expectedVersion: current.version,
        mutations: [
          {
            type: "resumeOperation",
            runId: this._runId,
            operationId: input.operationId,
            parkId: input.parkId,
            requestFingerprint: input.requestFingerprint,
            resumeSchemaFingerprint: input.resumeSchemaFingerprint
          },
          {
            type: "settleOperation",
            runId: this._runId,
            operationId: input.operationId,
            requestFingerprint: input.requestFingerprint,
            state: "cancelled"
          }
        ]
      });
      await this._onCommitted?.(committed);
      const operation = _requiredOperation(committed, input.operationId);
      this._activeStepId = operation.stepId;
      return operation;
    });
  }

  toolBatchMutations(options: {
    readonly checkpoint: boolean;
  }): readonly RuntimeSessionMutation[] {
    if (!this._sessionStore) { return []; }
    const mutations: RuntimeSessionMutation[] = [...this._pendingTools.values()]
      .map(item => item.mutation);
    if (options.checkpoint && this._activeStepId) {
      mutations.push({
        type: "checkpointOperationStep",
        runId: this._runId,
        stepId: this._activeStepId
      });
    }
    return mutations;
  }

  hasUnknownToolOutcome(): boolean {
    return [...this._pendingTools.values()].some(item => item.unknown);
  }

  unknownToolOperationId(): string | null {
    return [...this._pendingTools.entries()].find(
      ([, item]) => item.unknown
    )?.[0] ?? null;
  }

  markToolBatchCommitted(options: { readonly checkpoint: boolean; }): void {
    this._pendingTools.clear();
    this._preparedTools.clear();
    if (options.checkpoint) {
      this._activeStepId = null;
    }
  }

  async checkpointProviderOnlyStep(): Promise<void> {
    if (!this._sessionStore || !this._activeStepId) { return; }
    await this._commit([{
      type: "checkpointOperationStep",
      runId: this._runId,
      stepId: this._activeStepId
    }]);
    this._activeStepId = null;
  }

  async checkpointDeferredToolStep(): Promise<void> {
    if (!this._sessionStore) { return; }
    const current = await this._sessionStore.load(this._sessionId);
    if (current?.snapshot.activeRunId !== this._runId) {
      return;
    }
    const step = _activeStep(current, this._runId);
    if (!step) { return; }
    await this._commit([{
      type: "checkpointOperationStep",
      runId: this._runId,
      stepId: step.id
    }]);
    this._activeStepId = null;
  }

  async commitProviderOnlyStepWith(
    mutations: readonly RuntimeSessionMutation[]
  ): Promise<StoredRuntimeSession> {
    if (!this._sessionStore) {
      throw new Error("Durable provider Session Store is unavailable");
    }
    if (!this._activeStepId) {
      return this._commit(mutations);
    }
    const stepId = this._activeStepId;
    const committed = await this._commit([
      ...mutations,
      {
        type: "checkpointOperationStep",
        runId: this._runId,
        stepId
      }
    ]);
    this._activeStepId = null;
    return committed;
  }

  private async _begin(input: {
    readonly kind: "provider";
    readonly provider: string;
    readonly providerSlot?: string;
    readonly requestFingerprint: string;
    readonly transcriptMessageCount: number;
  } | {
    readonly kind: "tool";
    readonly requestFingerprint: string;
    readonly toolCallId: string;
  }): Promise<DurableOperationBeginResult> {
    const store = this._requiredStore();
    const current = await store.load(this._sessionId);
    if (current?.snapshot.activeRunId !== this._runId) {
      throw new Error(
        `Runtime Run ${this._runId} is not active in Session ${this._sessionId}`
      );
    }
    let step = _activeStep(current, this._runId);
    if (!step) {
      if (input.kind !== "provider") {
        throw new Error(
          `Tool ${input.toolCallId} has no active durable provider Step`
        );
      }
      const sequence = _nextStepSequence(current, this._runId);
      const stepId = `${this._runId}:step:${sequence}`;
      step = {
        id: stepId,
        runId: this._runId,
        sequence,
        state: "active",
        transcriptMessageCount: input.transcriptMessageCount,
        operations: []
      };
    }
    this._activeStepId = step.id;
    const operationId = input.kind === "provider"
      ? `${step.id}:provider:${encodeURIComponent(input.provider)}${
        input.providerSlot
          ? `:${encodeURIComponent(input.providerSlot)}`
          : ""
      }`
      : `${step.id}:tool:${input.toolCallId}`;
    const existing = step.operations.find(operation =>
      operation.id === operationId);
    if (existing) {
      return this._existing(existing, input.requestFingerprint);
    }
    if (
      input.kind === "provider"
      && input.providerSlot === undefined
      && step.operations.some(operation => operation.kind === "provider")
    ) {
      throw new DurableOperationFingerprintMismatchError(operationId);
    }
    if (input.kind === "provider" && input.providerSlot === undefined) {
      const run = current.snapshot.runs.find(item => item.id === this._runId);
      const configuration = current.configurations.find(
        item => item.id === run?.configurationId
      );
      const limit = configuration?.limits?.maxModelCallsPerRun;
      if (typeof limit === "number") {
        const consumed = current.snapshot.operationLedger?.steps
          .filter(item => item.runId === this._runId)
          .flatMap(item => item.operations)
          .filter(operation =>
            operation.kind === "provider"
            && operation.providerSlot === undefined
            && operation.state !== "cancelled").length ?? 0;
        if (consumed >= limit) {
          const failure = {
            axis: "modelCalls" as const,
            attempted: consumed + 1,
            code: "runLimitExceeded" as const,
            consumed,
            limit
          };
          const failed = await store.commit({
            sessionId: this._sessionId,
            expectedVersion: current.version,
            mutations: [{
              type: "transitionRun",
              runId: this._runId,
              to: "failed",
              failure
            }]
          });
          await this._onCommitted?.(failed);
          throw new RuntimeRunLimitExceededError(failure);
        }
      }
    }
    const committed = await store.commit({
      sessionId: this._sessionId,
      expectedVersion: current.version,
      mutations: [{
        type: "startOperation",
        runId: this._runId,
        stepId: step.id,
        stepSequence: step.sequence,
        transcriptMessageCount: step.transcriptMessageCount,
        operationId,
        kind: input.kind,
        requestFingerprint: input.requestFingerprint,
        ...(input.kind === "provider"
          ? {
            provider: input.provider,
            ...(input.providerSlot ? { providerSlot: input.providerSlot } : {})
          }
          : { toolCallId: input.toolCallId })
      }]
    });
    await this._onCommitted?.(committed);
    const operation = _requiredOperation(committed, operationId);
    return { type: "dispatch", operation };
  }

  private async _existing(
    operation: RuntimeDurableOperationSnapshot,
    requestFingerprint: string
  ): Promise<DurableOperationBeginResult> {
    if (operation.requestFingerprint !== requestFingerprint) {
      throw new DurableOperationFingerprintMismatchError(operation.id);
    }
    if (operation.state === "completed" || operation.state === "failed") {
      if (!operation.replay) {
        throw new DurableOperationOutcomeUnknownError(
          operation.id,
          `Durable operation ${operation.id} no longer retains replay material`
        );
      }
      return {
        type: "replay",
        operation,
        value: operation.replay.value
      };
    }
    if (operation.state === "parked" && operation.park) {
      throw new DurableOperationParkedError(
        operation.id,
        operation.park.parkId
      );
    }
    throw new DurableOperationOutcomeUnknownError(operation.id);
  }

  private async _queueToolSettlement(input: {
    readonly operation: RuntimeDurableOperationSnapshot;
    readonly replay?: RuntimeDurableOperationReplayEnvelope;
    readonly state: "completed" | "failed" | "outcomeUnknown";
  }): Promise<void> {
    let state = input.state;
    let replay = input.replay;
    if (replay) {
      try {
        await this._assertStepReplayLimit(
          input.operation.stepId,
          replay.byteLength,
          input.operation.id
        );
      } catch {
        state = "outcomeUnknown";
        replay = undefined;
      }
    }
    this._pendingTools.set(input.operation.id, {
      unknown: state === "outcomeUnknown",
      mutation: {
        type: "settleOperation",
        runId: this._runId,
        operationId: input.operation.id,
        requestFingerprint: input.operation.requestFingerprint,
        state,
        ...(replay ? { replay } : {})
      }
    });
    if (state === "outcomeUnknown") {
      throw new DurableOperationOutcomeUnknownError(input.operation.id);
    }
  }

  private async _assertStepReplayLimit(
    stepId: string,
    addedBytes: number,
    excludePendingOperationId?: string
  ): Promise<void> {
    const current = await this._requiredStore().load(this._sessionId);
    const step = current?.snapshot.operationLedger?.steps.find(
      item => item.id === stepId
    );
    const durableBytes = step?.operations.reduce(
      (total, operation) => total + (operation.replay?.byteLength ?? 0),
      0
    ) ?? 0;
    const pendingBytes = [...this._pendingTools.entries()].reduce(
      (total, [operationId, pending]) => total + (
        operationId === excludePendingOperationId
          ? 0
          : pending.mutation.replay?.byteLength ?? 0
      ),
      0
    );
    if (durableBytes + pendingBytes + addedBytes > MAX_DURABLE_STEP_REPLAY_BYTES) {
      throw new Error(
        `Durable Step ${stepId} replay material exceeds ${MAX_DURABLE_STEP_REPLAY_BYTES} bytes`
      );
    }
  }

  private async _commit(
    mutations: readonly RuntimeSessionMutation[]
  ): Promise<StoredRuntimeSession> {
    return this._serialize(async () => {
      const store = this._requiredStore();
      const current = await store.load(this._sessionId);
      if (!current) {
        throw new Error(`Runtime Session ${this._sessionId} disappeared`);
      }
      const committed = await store.commit({
        sessionId: this._sessionId,
        expectedVersion: current.version,
        mutations
      });
      await this._onCommitted?.(committed);
      return committed;
    });
  }

  private _requiredStore(): SessionStore {
    if (!this._sessionStore) {
      throw new Error("Durable operation Session Store is unavailable");
    }
    return this._sessionStore;
  }

  private async _serialize<T>(action: () => Promise<T>): Promise<T> {
    const result = this._commitTail.then(action);
    this._commitTail = result.then(() => {}, () => {});
    return result;
  }
}

function _replayProviderMessage(
  operation: RuntimeDurableOperationSnapshot,
  value: RuntimeJsonValue
): AssistantMessage {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DurableOperationOutcomeUnknownError(operation.id);
  }
  const record = value as Record<string, RuntimeJsonValue>;
  const message = record.type === "providerMessage"
    ? record.message as unknown as AssistantMessage
    : null;
  if (
    message?.role !== "assistant"
    || (operation.state !== "completed" && operation.state !== "failed")
  ) {
    throw new DurableOperationOutcomeUnknownError(operation.id);
  }
  return message;
}

export async function fingerprintDurableOperationValue(
  value: unknown
): Promise<string> {
  return sha256(_canonicalJson(_jsonSnapshot(value)));
}

export async function createDurableOperationReplayEnvelope(
  value: unknown
): Promise<RuntimeDurableOperationReplayEnvelope> {
  const snapshot = _jsonSnapshot(value);
  const canonical = _canonicalJson(snapshot);
  const byteLength = new TextEncoder().encode(canonical).byteLength;
  if (byteLength > MAX_DURABLE_OPERATION_REPLAY_BYTES) {
    throw new Error(
      `Durable operation replay material exceeds ${MAX_DURABLE_OPERATION_REPLAY_BYTES} bytes`
    );
  }
  return {
    byteLength,
    resultFingerprint: await sha256(canonical),
    value: snapshot
  };
}

function _activeStep(
  session: StoredRuntimeSession,
  runId: string
): RuntimeDurableStepSnapshot | undefined {
  return session.snapshot.operationLedger?.steps.find(
    step => step.runId === runId && step.state === "active"
  );
}

function _nextStepSequence(
  session: StoredRuntimeSession,
  runId: string
): number {
  return Math.max(
    0,
    ...(session.snapshot.operationLedger?.steps
      .filter(step => step.runId === runId)
      .map(step => step.sequence) ?? [])
  ) + 1;
}

function _requiredOperation(
  session: StoredRuntimeSession,
  operationId: string
): RuntimeDurableOperationSnapshot {
  const operation = session.snapshot.operationLedger?.steps
    .flatMap(step => step.operations)
    .find(item => item.id === operationId);
  if (!operation) {
    throw new Error(`Durable operation ${operationId} disappeared`);
  }
  return operation;
}

function _replayToolOutcome(
  operation: RuntimeDurableOperationSnapshot,
  value: RuntimeJsonValue
): Awaited<ReturnType<Extract<PreparedAgentTool, { kind: "executable"; }>["execute"]>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DurableOperationOutcomeUnknownError(operation.id);
  }
  const record = value as Record<string, RuntimeJsonValue>;
  if (operation.state === "failed" && record.type === "toolError") {
    const error = record.error;
    const message = error && typeof error === "object" && !Array.isArray(error)
      ? (error as Record<string, RuntimeJsonValue>).message
      : undefined;
    throw new Error(typeof message === "string" ? message : "Tool failed");
  }
  if (
    (operation.state === "completed" || operation.state === "failed")
    && record.type === "toolOutcome"
  ) {
    return record.outcome as Awaited<ReturnType<Extract<
      PreparedAgentTool,
      { kind: "executable"; }
    >["execute"]>>;
  }
  throw new DurableOperationOutcomeUnknownError(operation.id);
}

function _jsonSnapshot(value: unknown): RuntimeJsonValue {
  let text: string | undefined;
  try {
    text = JSON.stringify(value);
  } catch (error) {
    throw new TypeError(
      `Durable operation replay material is not serializable: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  if (text === undefined) {
    throw new TypeError("Durable operation replay material is not JSON data");
  }
  return JSON.parse(text) as RuntimeJsonValue;
}

function _canonicalJson(value: RuntimeJsonValue): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(_canonicalJson).join(",")}]`;
  }
  const record = value as Readonly<Record<string, RuntimeJsonValue>>;
  return `{${Object.keys(record).sort().map(key =>
    `${JSON.stringify(key)}:${_canonicalJson(_requiredJsonValue(record, key))}`)
    .join(",")}}`;
}

function _requiredJsonValue(
  record: Readonly<Record<string, RuntimeJsonValue>>,
  key: string
): RuntimeJsonValue {
  const value = record[key];
  if (value === undefined) {
    throw new TypeError(`Durable JSON object is missing ${key}`);
  }
  return value;
}
