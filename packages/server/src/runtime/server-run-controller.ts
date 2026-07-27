import { createHash } from "node:crypto";
import {
  claimRuntimeRunResume,
  runtimeRunHasParkedToolApprovals,
  runtimeSessionBudgetView,
  type RuntimeStructuredOutputResult
} from "@llm-space/runtime/harness";
import {
  type AgentHostApprovalPolicy,
  AgentHostPolicyChangedError,
  AgentRuntime,
  AgentStateCommitUnknownError,
  type CompiledAgentProjectSnapshot,
  createAgentSubagentTool,
  createHostCapabilityPolicy,
  DurableOperationOutcomeUnknownError,
  ExecutionEnvUnavailableError,
  RuntimeRunLimitExceededError,
  RuntimeToolApprovalStaleError,
  type SandboxProvider,
  type SandboxTurnEnvironment,
  SandboxUnavailableError,
  SandboxWorkspaceLostError,
  StructuredOutputError
} from "@llm-space/runtime/server";

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Models, UserMessage } from "@earendil-works/pi-ai";
import type { AgentCapabilityPolicy } from "@llm-space/runtime";
import type { RuntimeWorkingBase } from "@llm-space/runtime/harness";

import { createServerAgentSubagentHost } from "./server-agent-subagent-host";
import { ServerCapacityError } from "./server-capacity-error";
import { serializePiAgentEvent } from "../protocol/pi-event-serializer";
import { ServerEventTooLargeError } from "../repository/server-event-too-large-error";

import type { ServerPrincipal } from "../auth/server-authenticator";
import type {
  CreatedServerRun,
  ServerRunTerminalOutcome,
  ServerSessionRepository,
  ServerSubagentRunRecord
} from "../repository/server-session-repository";

export interface ServerRunControllerOptions {
  readonly approvalPolicy?: AgentHostApprovalPolicy;
  readonly maxActiveRuns?: number;
  readonly maxStructuredOutputBytes?: number;
  readonly models: Models;
  readonly project: CompiledAgentProjectSnapshot;
  readonly repository: ServerSessionRepository;
  readonly sandboxProvider?: SandboxProvider;
}

export class ServerRunController {
  private readonly _runtime: AgentRuntime;
  private readonly _capabilityPolicy: AgentCapabilityPolicy;
  private readonly _approvalPolicy?: AgentHostApprovalPolicy;
  private readonly _repository: ServerSessionRepository;
  private readonly _sandboxProvider?: SandboxProvider;
  private readonly _subagentHost: ReturnType<typeof createServerAgentSubagentHost>;
  private readonly _active = new Map<string, { abort(): void; }>();
  private readonly _abortedRuns = new Set<string>();
  private readonly _pendingRuns = new Set<string>();
  private readonly _executions = new Set<Promise<void>>();
  private readonly _recoveryQueue: CreatedServerRun[] = [];
  private _creationTail: Promise<void> = Promise.resolve();
  private _detached = false;
  private _inFlight = 0;
  private readonly _maxActiveRuns: number;

  constructor(options: ServerRunControllerOptions) {
    this._runtime = new AgentRuntime({
      models: options.models,
      project: options.project,
      maxStructuredOutputBytes: options.maxStructuredOutputBytes
    });
    this._capabilityPolicy = createHostCapabilityPolicy({
      models: options.models,
      project: options.project
    });
    this._approvalPolicy = options.approvalPolicy;
    if (
      this._approvalPolicy
      && (
        this._approvalPolicy.id.trim().length === 0
        || this._approvalPolicy.id.length > 256
      )
    ) {
      throw new TypeError("Server approval policy id must contain 1-256 characters");
    }
    this._sandboxProvider = options.sandboxProvider;
    if (this._runtime.project.sandbox && !this._sandboxProvider) {
      throw new SandboxUnavailableError(
        "The Agent requires Sandbox but this Server Host has no SandboxProvider"
      );
    }
    if (!this._runtime.defaultModel.available) {
      throw new Error("Compiled Agent default model is unavailable");
    }
    this._repository = options.repository;
    this._subagentHost = createServerAgentSubagentHost({
      ...(options.approvalPolicy
        ? { approvalPolicy: options.approvalPolicy }
        : {}),
      models: options.models,
      project: options.project,
      repository: options.repository,
      sandboxProvider: options.sandboxProvider
    });
    this._maxActiveRuns = options.maxActiveRuns ?? 4;
    if (
      !Number.isInteger(this._maxActiveRuns)
      || this._maxActiveRuns < 1
      || this._maxActiveRuns > 64
    ) {
      throw new TypeError("maxActiveRuns must be an integer from 1 through 64");
    }
  }

  async createRun(input: {
    readonly continuationToken: string;
    readonly idempotencyKey: string;
    readonly outputContract?: string;
    readonly owner: ServerPrincipal;
    readonly sessionId: string;
    readonly text: string;
    readonly workingBase?: RuntimeWorkingBase;
  }): Promise<CreatedServerRun> {
    const result = this._creationTail.then(async () => this._createRun(input));
    this._creationTail = result.then(() => {}, () => {});
    return result;
  }

  resumeRun(run: CreatedServerRun): void {
    if (this._detached) { return; }
    this._recoveryQueue.push(run);
    this._drainRecoveryQueue();
  }

  private async _createRun(input: {
    readonly continuationToken: string;
    readonly idempotencyKey: string;
    readonly outputContract?: string;
    readonly owner: ServerPrincipal;
    readonly sessionId: string;
    readonly text: string;
    readonly workingBase?: RuntimeWorkingBase;
  }): Promise<CreatedServerRun> {
    const definition = this._runtime.project.definition;
    if (!definition) {
      throw new Error("Compiled Agent definition is unavailable");
    }
    const idempotent = await this._repository.findIdempotentRun({
      ...input,
      inputText: input.text
    });
    if (idempotent) {
      return idempotent;
    }
    const userMessage: UserMessage = {
      role: "user",
      content: [{ type: "text", text: input.text }],
      timestamp: Date.now()
    };
    const contextFingerprint = _sha256(JSON.stringify([
      ...this._repository.authorizedTranscript({
        ...input,
        ...(input.workingBase ? { workingBase: input.workingBase } : {})
      }),
      userMessage
    ]));
    const toolConfigurationFingerprint = _sha256(
      JSON.stringify(this._runtime.project.tools.map(tool => tool.name))
    );
    const outputDefinition = input.outputContract
      ? this._runtime.project.outputDefinitions?.find(
        output => output.name === input.outputContract
      )
      : undefined;
    if (input.outputContract && !outputDefinition) {
      throw new TypeError(
        `Unknown structured output contract: ${input.outputContract}`
      );
    }
    const outputContract = outputDefinition
      ? {
        name: outputDefinition.name,
        schemaFingerprint: outputDefinition.schemaFingerprint
      }
      : undefined;
    const configurationIdentity = JSON.stringify({
      agentSnapshotFingerprint: this._runtime.project.fingerprint,
      contextFingerprint,
      executionMode: "react",
      model: definition.model,
      limits: definition.limits ?? null,
      reasoning: definition.reasoning,
      toolConfigurationFingerprint,
      outputContract: outputContract ?? null,
      maxStructuredOutputBytes: this._runtime.maxStructuredOutputBytes
    });
    const configuration = {
      id: `configuration-${_sha256(configurationIdentity)}`,
      agentSnapshotFingerprint: this._runtime.project.fingerprint,
      contextFingerprint,
      executionMode: "react" as const,
      model: definition.model,
      ...(definition.limits ? { limits: definition.limits } : {}),
      reasoning: definition.reasoning,
      toolConfigurationFingerprint,
      ...(outputContract ? { outputContract } : {}),
      maxStructuredOutputBytes: this._runtime.maxStructuredOutputBytes
    };
    if (this._inFlight >= this._maxActiveRuns) {
      throw new ServerCapacityError();
    }
    this._inFlight += 1;
    try {
      const created = await this._repository.createRun({
        ...input,
        inputText: input.text,
        userMessage,
        configuration,
        ...(input.outputContract ? { outputContract: input.outputContract } : {})
      });
      if (created.created) {
        this._startExecution(created);
      } else {
        this._inFlight -= 1;
      }
      return created;
    } catch (error) {
      this._inFlight -= 1;
      throw error;
    }
  }

  abort(runId: string): boolean {
    const active = this._active.get(runId);
    const known = Boolean(active) || this._pendingRuns.has(runId);
    if (known) {
      this._abortedRuns.add(runId);
    }
    active?.abort();
    return known;
  }

  abortAll(): void {
    for (const runId of this._pendingRuns) {
      this.abort(runId);
    }
  }

  detach(): void {
    this._detached = true;
    this._active.clear();
    this._pendingRuns.clear();
    this._recoveryQueue.length = 0;
  }

  async waitForIdle(): Promise<void> {
    while (this._executions.size > 0) {
      await Promise.allSettled([...this._executions]);
    }
  }

  private async _execute(run: CreatedServerRun): Promise<void> {
    let outcome: ServerRunTerminalOutcome = "completed";
    let code: string | undefined;
    let structuredOutput: RuntimeStructuredOutputResult | undefined;
    let parkedForApproval = false;
    let parkedForBudget = false;
    let parkedForSubagent = false;
    try {
      let persistedRuntime = await this._repository.load(run.sessionId);
      const sandboxSession = this._runtime.project.sandbox
        && this._sandboxProvider
        ? await this._sandboxProvider.acquire({
          expectedExisting: Object.keys(
            persistedRuntime?.snapshot.instructionSnapshots ?? {}
          ).length > 0,
          seed: this._runtime.project.sandbox?.workspace ?? [],
          sessionId: run.sessionId
        })
        : undefined;
      const sandbox = sandboxSession
        ? {
          executionEnv: sandboxSession.executionEnv,
          revalidationFingerprint:
            this._runtime.project.sandbox?.revalidationFingerprint,
          workspaceManifest: await sandboxSession.workspaceManifest()
        }
        : undefined;
      const child = this._repository.subagentRunForParent(
        run.sessionId,
        run.runId
      );
      const childOutcome = child
        ? await this._resumeSubagent(run, child, sandbox)
        : null;
      if (childOutcome?.type === "deferred") {
        parkedForSubagent = true;
        return;
      }
      const parentRun = persistedRuntime?.snapshot.runs.find(
        candidate => candidate.id === run.runId
      );
      if (
        childOutcome
        && persistedRuntime
        && parentRun?.state === "waitingForToolResults"
      ) {
        persistedRuntime = await claimRuntimeRunResume(this._repository, {
          expectedVersion: persistedRuntime.version,
          runId: run.runId,
          sessionId: run.sessionId
        });
      }
      const session = await this._runtime.createSession({
        ...(this._approvalPolicy
          ? { approvalPolicy: this._approvalPolicy }
          : {}),
        capabilityPolicy: this._capabilityPolicy,
        id: run.sessionId,
        context: {
          id: run.sessionId,
          auth: {
            initiator: run.initiator,
            current: run.owner
          },
          ...(run.owner.tenant ? { tenant: run.owner.tenant } : {}),
          channel: { kind: "http" },
          turn: { id: run.runId, sequence: run.turnSequence }
        },
        sessionStore: this._repository,
        executionMode: "react",
        initialMessages: run.transcript as AgentMessage[],
        ...(sandbox ? { sandbox } : {}),
        ...(run.outputContract ? { outputContract: run.outputContract } : {}),
        persistence: {
          replaceMessages: async messages => {
            if (!this._detached) {
              await this._repository.replaceTranscript(run.sessionId, messages);
            }
          }
        },
        subagentHost: this._subagentHost
      });
      this._active.set(run.runId, session);
      if (this._abortedRuns.has(run.runId)) {
        session.abort();
      }
      let eventFailure: Error | null = null;
      session.subscribe(async event => {
        if (this._detached) {
          return;
        }
        try {
          if (event.type === "tool_calls_deferred") {
            const current = await this._repository.load(run.sessionId);
            const pending = current?.snapshot.approvalLedger?.requests.some(
              request => request.runId === run.runId
                && request.state === "pending"
            ) ?? false;
            if (!pending) {
              const child = this._repository.subagentRunForParent(
                run.sessionId,
                run.runId
              );
              const childPending = child?.runtime.snapshot.approvalLedger
                ?.requests.some(request =>
                  request.runId === child.child.runId
                  && request.state === "pending") ?? false;
              if (!childPending) {
                throw new Error("Server ReAct mode cannot defer tool calls");
              }
              parkedForSubagent = true;
              return;
            }
            parkedForApproval = true;
            return;
          }
          const serialized = serializePiAgentEvent(event);
          await this._repository.appendEvent(run.sessionId, run.runId, {
            event: "pi",
            data: serialized
          });
        } catch (error) {
          eventFailure = error instanceof Error
            ? error
            : new TypeError("Pi event serialization failed");
          session.abort();
        }
      });
      if (this._abortedRuns.has(run.runId)) {
        outcome = "cancelled";
      } else {
        const resumesApproval = persistedRuntime
          ? runtimeRunHasParkedToolApprovals(persistedRuntime, run.runId)
          : false;
        if (childOutcome?.type === "completed") {
          if (!child) {
            throw new Error("Completed Subagent outcome has no parent record");
          }
          await session.resolveToolResults([{
            role: "toolResult",
            toolCallId: child.parent.toolCallId,
            toolName: child.subagentId,
            content: childOutcome.result.content,
            details: childOutcome.result.details,
            isError: childOutcome.result.isError ?? false,
            timestamp: Date.now()
          }]);
          await session.continue();
        } else if (resumesApproval) {
          await session.resumeApprovedTools();
        } else {
          await session.continue();
        }
        structuredOutput = session.structuredOutput ?? undefined;
        const current = await this._repository.load(run.sessionId);
        parkedForBudget = current?.snapshot.runs.find(
          item => item.id === run.runId
        )?.state === "waitingForBudget";
      }
      _throwEventFailure(eventFailure);
      if (this._abortedRuns.has(run.runId)) {
        outcome = "cancelled";
      }
      const last = session.messages.at(-1);
      if (outcome !== "cancelled" && last?.role === "assistant") {
        if (last.stopReason === "aborted") {
          outcome = "cancelled";
        } else if (last.stopReason === "error") {
          outcome = "failed";
          code = "agent_error";
        }
      }
    } catch (error) {
      if (error instanceof DurableOperationOutcomeUnknownError) {
        outcome = "outcomeUnknown";
        code = error.code;
      } else if (this._abortedRuns.has(run.runId)) {
        outcome = "cancelled";
      } else if (error instanceof AgentStateCommitUnknownError) {
        outcome = "outcomeUnknown";
        code = "session_state_commit_unknown";
      } else if (error instanceof AgentHostPolicyChangedError) {
        outcome = "failed";
        code = "hostPolicyChanged";
      } else if (error instanceof RuntimeToolApprovalStaleError) {
        outcome = "failed";
        code = error.code;
      } else if (error instanceof RuntimeRunLimitExceededError) {
        outcome = "failed";
        code = error.code;
      } else if (error instanceof ExecutionEnvUnavailableError) {
        outcome = "failed";
        code = "executionEnvUnavailable";
      } else if (error instanceof SandboxUnavailableError) {
        outcome = "failed";
        code = error.code;
      } else if (error instanceof SandboxWorkspaceLostError) {
        outcome = "failed";
        code = error.code;
      } else if (error instanceof StructuredOutputError) {
        outcome = "failed";
        code = error.code;
      } else {
        outcome = "failed";
        code = error instanceof ServerEventTooLargeError
          ? "event_too_large"
          : error instanceof TypeError
            ? "event_not_serializable"
            : "agent_error";
      }
    } finally {
      try {
        if (!this._detached && parkedForSubagent) {
          await this._publishSubagentWait(run);
        } else if (!this._detached && parkedForApproval) {
          await this._parkRunForApproval(run);
        } else if (!this._detached && parkedForBudget) {
          await this._publishBudgetWait(run);
        } else if (!this._detached) {
          await this._repository.completeRun({
            sessionId: run.sessionId,
            runId: run.runId,
            outcome,
            ...(code ? { code } : {}),
            ...(structuredOutput ? { structuredOutput } : {})
          });
        }
      } finally {
        this._active.delete(run.runId);
        this._abortedRuns.delete(run.runId);
        this._pendingRuns.delete(run.runId);
        this._inFlight -= 1;
        this._drainRecoveryQueue();
      }
    }
  }

  private async _resumeSubagent(
    run: CreatedServerRun,
    child: ServerSubagentRunRecord,
    parentSandbox?: SandboxTurnEnvironment
  ) {
    const subagent = this._runtime.project.subagents?.find(candidate =>
      candidate.id === child.subagentId
      && candidate.project.artifact.fingerprint === child.artifactFingerprint);
    if (!subagent) {
      throw new Error("The frozen Server Subagent artifact is unavailable");
    }
    const tool = createAgentSubagentTool({
      context: {
        id: run.sessionId,
        auth: { initiator: run.initiator, current: run.owner },
        ...(run.owner.tenant ? { tenant: run.owner.tenant } : {}),
        channel: { kind: "http" },
        turn: { id: run.runId, sequence: run.turnSequence }
      },
      host: this._subagentHost,
      models: this._runtime.models,
      parentSandbox,
      subagent
    });
    if (tool.kind !== "executable") {
      throw new Error("Server Subagent tool is not executable");
    }
    return tool.execute(
      child.parent.toolCallId,
      { message: child.message }
    );
  }

  private async _publishSubagentWait(run: CreatedServerRun): Promise<void> {
    const child = this._repository.subagentRunForParent(
      run.sessionId,
      run.runId
    );
    const approvals = child?.runtime.snapshot.approvalLedger?.requests
      .filter(request =>
        request.runId === child.child.runId && request.state === "pending")
      .map(request => ({
        id: request.id,
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        scope: request.scope,
        ...(request.reason ? { reason: request.reason } : {})
      })) ?? [];
    if (!child || approvals.length === 0) {
      throw new Error("Server Subagent wait has no pending approval");
    }
    const current = await this._repository.load(run.sessionId);
    const runtimeRun = current?.snapshot.runs.find(item => item.id === run.runId);
    if (!current || !runtimeRun) {
      throw new Error("Parent Runtime Run disappeared while parking Subagent");
    }
    const mutations = runtimeRun.state === "runningModel"
      ? [
        {
          type: "transitionRun" as const,
          runId: run.runId,
          to: "runningTools" as const
        },
        {
          type: "transitionRun" as const,
          runId: run.runId,
          to: "waitingForToolResults" as const
        }
      ]
      : runtimeRun.state === "runningTools"
        ? [{
          type: "transitionRun" as const,
          runId: run.runId,
          to: "waitingForToolResults" as const
        }]
        : [];
    if (mutations.length > 0) {
      await this._repository.commit({
        sessionId: run.sessionId,
        expectedVersion: current.version,
        mutations
      });
    }
    await this._repository.appendEvent(run.sessionId, run.runId, {
      event: "control",
      data: { type: "toolApprovalRequired", approvals }
    });
  }

  private async _parkRunForApproval(run: CreatedServerRun): Promise<void> {
    const current = await this._repository.load(run.sessionId);
    const runtimeRun = current?.snapshot.runs.find(item => item.id === run.runId);
    if (!current || !runtimeRun) {
      throw new Error("Runtime Run disappeared while parking approval");
    }
    const mutations = runtimeRun.state === "runningModel"
      ? [
        { type: "transitionRun" as const, runId: run.runId, to: "runningTools" as const },
        {
          type: "transitionRun" as const,
          runId: run.runId,
          to: "waitingForApproval" as const
        }
      ]
      : runtimeRun.state === "runningTools"
        ? [{
          type: "transitionRun" as const,
          runId: run.runId,
          to: "waitingForApproval" as const
        }]
        : [];
    if (mutations.length > 0) {
      await this._repository.commit({
        sessionId: run.sessionId,
        expectedVersion: current.version,
        mutations
      });
    }
    const parked = await this._repository.load(run.sessionId);
    const approvals = parked?.snapshot.approvalLedger?.requests
      .filter(request => request.runId === run.runId && request.state === "pending")
      .map(request => ({
        id: request.id,
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        scope: request.scope,
        ...(request.reason ? { reason: request.reason } : {})
      })) ?? [];
    await this._repository.appendEvent(run.sessionId, run.runId, {
      event: "control",
      data: { type: "toolApprovalRequired", approvals }
    });
  }

  private async _publishBudgetWait(run: CreatedServerRun): Promise<void> {
    const current = await this._repository.load(run.sessionId);
    const budget = current ? runtimeSessionBudgetView(current).wait : null;
    if (!current || budget?.runId !== run.runId || budget.status !== "waiting") {
      throw new Error("Runtime Session budget wait disappeared before publish");
    }
    await this._repository.appendEvent(run.sessionId, run.runId, {
      event: "control",
      data: { type: "sessionBudgetRequired", budget, session: current }
    });
  }

  private _drainRecoveryQueue(): void {
    while (
      !this._detached
      && this._inFlight < this._maxActiveRuns
      && this._recoveryQueue.length > 0
    ) {
      const run = this._recoveryQueue.shift();
      if (!run) { return; }
      this._inFlight += 1;
      this._startExecution(run);
    }
  }

  private _startExecution(run: CreatedServerRun): void {
    this._pendingRuns.add(run.runId);
    const execution = this._execute(run);
    this._executions.add(execution);
    void execution.then(
      () => { this._executions.delete(execution); },
      () => { this._executions.delete(execution); }
    );
  }
}

export { ServerCapacityError } from "./server-capacity-error";

function _sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function _throwEventFailure(error: Error | null): void {
  if (error) {
    throw error;
  }
}
