import {
  Agent,
  type AgentMessage,
  type BeforeToolCallContext,
  convertToLlm as convertHarnessMessagesToLlm,
  type ExecutionEnv,
  type StreamFn,
  type ThinkingLevel
} from "@earendil-works/pi-agent-core";
import { Compile } from "typebox/compile";

import type {
  Api,
  Model,
  Models,
  SimpleStreamOptions,
  ToolResultMessage
} from "@earendil-works/pi-ai";

import { AgentEventProjector, type AgentSessionEvent, type AgentSessionPersistence } from "../../execution/agent-event-projector";
import { ToolExecutionPolicy } from "../../execution/tool-execution-policy";
import { isApprovalRequirement } from "../../public/definitions/approval";
import { STRUCTURED_OUTPUT_TOOL_NAME } from "../../shared/structured-output";
import { resolveAgentRuntimeModel } from "../agent/resolve-model";
import {
  RuntimeSessionBudgetCoordinator
} from "../budget/runtime-session-budget-coordinator";
import {
  type AgentCapabilityRequest,
  AgentHostPolicyChangedError,
  AgentSessionCapabilities
} from "../capabilities/agent-session-capabilities";
import {
  RuntimeCompactionCoordinator,
  runtimeCompactionErrorStream,
  type RuntimeCompactionPhase
} from "../compaction/runtime-compaction-coordinator";
import { ExecutionEnvUnavailableError } from "../execution-env/execution-env-unavailable-error";
import { DurableOperationOutcomeUnknownError } from "../harness/durable-operation-outcome-unknown-error";
import { fingerprintRuntimeApprovalPrincipal } from "../harness/runtime-approval-principal";
import { RuntimeToolApprovalStaleError } from "../harness/runtime-tool-approval-stale-error";
import { runtimeRunHasParkedToolApprovals } from "../harness/runtime-tool-approval-view";
import { AgentSessionInstructions } from "../instructions/agent-session-instructions";
import {
  DurableOperationCoordinator,
  fingerprintDurableOperationValue
} from "../operations/durable-operation-coordinator";
import { createDurableProviderStream } from "../operations/durable-provider-stream";
import {
  createStructuredOutputTool
} from "../outputs/create-structured-output-tool";
import { StructuredOutputError } from "../outputs/structured-output-error";
import { DEFAULT_MAX_STRUCTURED_OUTPUT_BYTES } from "../outputs/structured-output-size";
import { AgentSessionState } from "../state/agent-session-state";

import type {
  Approval,
  ApprovalContext
} from "../../public/definitions/approval";
import type { AgentHostApprovalPolicy } from "../../shared/agent-approval-policy";
import type { AgentCapabilityPolicy } from "../../shared/agent-capability-policy";
import type {
  AgentModelOptionsDefinition,
  AgentModelSelector
} from "../../shared/agent-definition";
import type { AgentSessionContext } from "../../shared/agent-session-context";
import type { RuntimeExecutionMode } from "../../shared/runtime-execution-mode";
import type {
  AgentProjectSnapshot,
  CompiledAgentOutputDefinition
} from "../agent/agent-project-snapshot";
import type { PreparedAgentTool } from "../agent/prepared-agent-tool";
import type { RuntimeStructuredOutputResult } from "../harness/runtime-run";
import type {
  RuntimeSessionMutation,
  RuntimeTurnCapabilitySnapshot,
  RuntimeTurnInstructionSnapshot,
  SessionStore,
  StoredRuntimeSession
} from "../harness/session-store";

export type { AgentSessionEvent, AgentSessionPersistence };

export interface AgentSessionOptions {
  id?: string;
  models: Models;
  project: AgentProjectSnapshot;
  model: Model<Api>;
  modelSelector: AgentModelSelector;
  reasoning?: ThinkingLevel;
  initialMessages: AgentMessage[];
  tools: PreparedAgentTool[];
  activeToolNames?: string[];
  approvalPolicy?: AgentHostApprovalPolicy;
  capabilityPolicy: AgentCapabilityPolicy;
  capabilityRequest: AgentCapabilityRequest;
  instructionsPrefix: string;
  systemPrompt?: string;
  executionMode: RuntimeExecutionMode;
  context: AgentSessionContext;
  sessionStore?: SessionStore;
  onSessionCommitted?: (session: StoredRuntimeSession) => Promise<void> | void;
  onPhase?: (phase: RuntimeCompactionPhase) => void;
  persistence?: AgentSessionPersistence;
  streamFn?: StreamFn;
  outputDefinition?: CompiledAgentOutputDefinition;
  maxStructuredOutputBytes?: number;
  executionEnv?: ExecutionEnv;
  sandboxInstruction?: string;
}

export class AgentSession {
  private readonly _agent: Agent;
  private readonly _project: AgentProjectSnapshot;
  private readonly _context: AgentSessionContext;
  private readonly _approvalPolicy?: AgentHostApprovalPolicy;
  private _modelSelector: AgentModelSelector;
  private _reasoning?: ThinkingLevel;
  private readonly _toolPolicy: ToolExecutionPolicy;
  private readonly _eventProjector: AgentEventProjector;
  private readonly _sessionState: AgentSessionState;
  private readonly _instructions: AgentSessionInstructions;
  private readonly _capabilities: AgentSessionCapabilities;
  private readonly _models: Models;
  private readonly _sessionStore?: SessionStore;
  private readonly _onSessionCommitted?: (
    session: StoredRuntimeSession
  ) => Promise<void> | void;

  private _modelOptions: AgentModelOptionsDefinition = {};
  private _capabilitySnapshot: RuntimeTurnCapabilitySnapshot | null = null;
  private _instructionSnapshot: RuntimeTurnInstructionSnapshot | null = null;
  private _resolvedWithoutSessionStore = false;
  private _terminalError: Error | null = null;
  private _executionMode: RuntimeExecutionMode;
  private readonly _outputTool?: PreparedAgentTool;
  private readonly _outputValidator?: ReturnType<typeof Compile>;
  private readonly _executionEnv?: ExecutionEnv;
  private readonly _durableOperations: DurableOperationCoordinator;
  private readonly _compaction: RuntimeCompactionCoordinator;
  private readonly _budget: RuntimeSessionBudgetCoordinator;
  private readonly _turnToolTermination = new Map<string, boolean>();
  private _structuredOutput: RuntimeStructuredOutputResult | null = null;
  private _approvalBatchPending = false;
  private _compactionAbortController: AbortController | null = null;

  constructor(options: AgentSessionOptions) {
    this._project = options.project;
    this._context = options.context;
    this._approvalPolicy = options.approvalPolicy;
    this._models = options.models;
    this._sessionStore = options.sessionStore;
    this._onSessionCommitted = options.onSessionCommitted;
    this._modelSelector = options.modelSelector;
    this._reasoning = options.reasoning;
    this._executionMode = options.executionMode;
    this._executionEnv = options.executionEnv;
    this._outputTool = options.outputDefinition
      ? createStructuredOutputTool({
        definition: options.outputDefinition,
        maxBytes: options.maxStructuredOutputBytes
          ?? DEFAULT_MAX_STRUCTURED_OUTPUT_BYTES,
        onFailure: error => { this._terminalError = error; },
        onResult: result => { this._structuredOutput = result; }
      })
      : undefined;
    this._outputValidator = options.outputDefinition
      ? Compile(options.outputDefinition.schema)
      : undefined;
    this._sessionState = new AgentSessionState({
      context: options.context,
      definitions: options.project.stateDefinitions ?? [],
      sessionStore: options.sessionStore,
      onCommitted: options.onSessionCommitted
    });
    this._durableOperations = new DurableOperationCoordinator({
      sessionId: options.context.id,
      runId: options.context.turn.id,
      sessionStore: options.sessionStore,
      onCommitted: options.onSessionCommitted
    });
    this._compaction = new RuntimeCompactionCoordinator({
      durableOperations: this._durableOperations,
      models: options.models,
      sessionId: options.context.id,
      runId: options.context.turn.id,
      sessionStore: options.sessionStore,
      onPhase: options.onPhase
    });
    this._budget = new RuntimeSessionBudgetCoordinator({
      sessionId: options.context.id,
      runId: options.context.turn.id,
      store: options.sessionStore,
      onCommitted: options.onSessionCommitted
    });
    this._instructions = new AgentSessionInstructions({
      context: this._sessionState.context,
      instructionsPrefix: options.instructionsPrefix,
      onCommitted: options.onSessionCommitted,
      project: options.project,
      sandboxInstruction: options.sandboxInstruction,
      sessionState: this._sessionState,
      sessionStore: options.sessionStore,
      systemPrompt: options.systemPrompt
    });
    const stateScopedTools = options.tools.map(tool => (tool.kind === "executable"
      ? {
        ...tool,
        execute: async (...args: Parameters<typeof tool.execute>) =>
          this._sessionState.executeTool(async () => tool.execute(...args))
      }
      : tool));
    this._capabilities = new AgentSessionCapabilities({
      context: options.context,
      models: options.models,
      policy: options.capabilityPolicy,
      project: options.project,
      request: options.capabilityRequest,
      sessionStoreAvailable: Boolean(options.sessionStore),
      sessionState: this._sessionState,
      tools: stateScopedTools
    });
    this._toolPolicy = new ToolExecutionPolicy({
      tools: stateScopedTools,
      activeToolNames: undefined
    });
    const providerStream: StreamFn = async (
      model,
      context,
      streamOptions
    ) => {
      const resolvedOptions = {
        ...streamOptions,
        ...this._modelOptions
      } as SimpleStreamOptions;
      return options.streamFn
        ? options.streamFn(model, context, resolvedOptions)
        : options.models.streamSimple(model, context, resolvedOptions);
    };
    const durableProviderStream = createDurableProviderStream({
      coordinator: this._durableOperations,
      stream: providerStream,
      transcriptMessageCount: () => this.messages.length,
      onTerminalError: error => { this._terminalError = error; }
    });
    const compactionGatedProviderStream: StreamFn = async (
      model,
      context,
      streamOptions
    ) => {
      const error = this._compaction.terminalError;
      if (error) {
        this._terminalError = error;
        return runtimeCompactionErrorStream(model, error);
      }
      return durableProviderStream(model, context, streamOptions);
    };
    this._agent = new Agent({
      sessionId: options.id,
      convertToLlm: convertHarnessMessagesToLlm,
      initialState: {
        systemPrompt: "",
        model: options.model,
        thinkingLevel: options.reasoning ?? "off",
        messages: this._toolPolicy.restoreDeferredPlaceholders(
          options.initialMessages,
          options.executionMode
        ),
        tools: this._toolPolicy.toolsForMode(options.executionMode)
      },
      streamFn: compactionGatedProviderStream,
      transformContext: async (messages, signal) => this._compaction.transform(
        messages,
        this._agent.state.model,
        this._agent.state.thinkingLevel,
        signal
      ),
      beforeToolCall: async (context, signal) =>
        this._beforeToolCall(context, signal),
      afterToolCall: async ({ result, toolCall }) => {
        const isError = this._toolPolicy.consumeResultError(toolCall.id);
        const terminate = this._executionMode === "autoOnce"
          ? true
          : result.terminate;
        this._turnToolTermination.set(toolCall.id, terminate === true);
        return isError === undefined && terminate === undefined
          ? undefined
          : {
            ...(isError === undefined ? {} : { isError }),
            ...(terminate === undefined ? {} : { terminate })
          };
      },
      shouldStopAfterTurn: async ({ message }) => {
        const calls = message.content.filter(content => content.type === "toolCall");
        const naturallyTerminates = calls.length === 0 || calls.every(call =>
          this._turnToolTermination.get(call.id) === true);
        this._turnToolTermination.clear();
        if (this._executionMode !== "react" || naturallyTerminates) {
          return false;
        }
        return this._budget.parkIfReached();
      },
      prepareNextTurnWithContext: async ({ toolResults }) => {
        try {
          let outputError: Error | null = null;
          if (
            this._outputTool
            && toolResults.some(result =>
              result.toolName === STRUCTURED_OUTPUT_TOOL_NAME)
            && !this._structuredOutput
          ) {
            if (!this._terminalError) {
              this._terminalError = new StructuredOutputError(
                "structured_output_invalid",
                "The selected structured output was invalid"
              );
            }
            outputError = this._terminalError;
          }
          const deferred = toolResults.some(result =>
            this._toolPolicy.isDeferredToolResult(result));
          const checkpoint = this._executionMode === "react"
            && toolResults.length > 0
            && !deferred
            && !toolResults.some(result =>
              result.toolName === STRUCTURED_OUTPUT_TOOL_NAME);
          const durableMutations = this._durableOperations
            .toolBatchMutations({ checkpoint });
          await this._sessionState.completeStep(toolResults, {
            deferred,
            durableMutations
          });
          const unknownOperationId = this._durableOperations
            .unknownToolOperationId();
          this._durableOperations.markToolBatchCommitted({ checkpoint });
          if (unknownOperationId) {
            throw new DurableOperationOutcomeUnknownError(unknownOperationId);
          }
          if (outputError) { throw outputError; }
          return undefined;
        } catch (error) {
          this._terminalError = error instanceof Error
            ? error
            : new Error(String(error));
          throw error;
        }
      }
    });
    this._eventProjector = new AgentEventProjector(
      () => this._executionMode,
      this._toolPolicy,
      () => this.messages,
      options.persistence
    );
    this._agent.subscribe(async event => this._eventProjector.handle(event));
  }

  get project(): AgentProjectSnapshot {
    return this._project;
  }

  get model(): AgentModelSelector {
    return this._modelSelector;
  }

  get reasoning(): ThinkingLevel | undefined {
    return this._reasoning;
  }

  get executionMode(): RuntimeExecutionMode {
    return this._executionMode;
  }

  get messages(): AgentMessage[] {
    return this._toolPolicy.publicMessages(this._agent.state.messages);
  }

  get instructionSnapshot(): RuntimeTurnInstructionSnapshot | null {
    return this._instructionSnapshot;
  }

  get capabilitySnapshot(): RuntimeTurnCapabilitySnapshot | null {
    return this._capabilitySnapshot;
  }

  get structuredOutput(): RuntimeStructuredOutputResult | null {
    return this._structuredOutput;
  }

  async prepareTurn(): Promise<void> {
    await this.validateState();
    await this._resolveTurnSetup();
  }

  async validateState(): Promise<void> {
    if (this._executionMode === "manual") { return; }
    await this._sessionState.validateSession();
  }

  setExecutionMode(mode: RuntimeExecutionMode): void {
    if (this._agent.state.isStreaming) {
      throw new Error(
        "Cannot change execution mode while the session is running"
      );
    }
    this._executionMode = mode;
    this._agent.state.tools = this._toolPolicy.toolsForMode(mode);
  }

  async prompt(message: AgentMessage | AgentMessage[] | string): Promise<void> {
    this._terminalError = null;
    this._structuredOutput = null;
    await this.validateState();
    await this._resolveTurnSetup();
    if (await this._budget.parkIfReached()) { return; }
    await this._agent.prompt(message as AgentMessage | AgentMessage[]);
    if (await this._budget.isWaiting()) { return; }
    this._assertStructuredOutputCompleted();
    this._throwTerminalError();
  }

  async resolveToolResults(results: ToolResultMessage[]): Promise<void> {
    if (this._agent.state.isStreaming) {
      throw new Error(
        "Cannot resolve tool results while the session is running"
      );
    }
    const messages = this._toolPolicy.restoreDeferredPlaceholders(
      this._agent.state.messages,
      this._executionMode,
      true
    );
    this._agent.state.messages = this._toolPolicy.replaceDeferredResults(
      messages,
      results
    );
    await this._durableOperations.checkpointDeferredToolStep();
    await this._eventProjector.handleToolResultsResolved();
  }

  async resumeApprovedTools(): Promise<void> {
    if (this._agent.state.isStreaming) {
      throw new Error("Cannot resume approved tools while the session is running");
    }
    const store = this._sessionStore;
    if (!store) {
      throw new Error("Approved tool resume requires a Session Store");
    }
    let current = await store.load(this._context.id);
    if (!current) {
      throw new Error("Approved tool resume requires a stored Runtime Session");
    }
    await this._staleApprovalBatchIfIdentityChanged(current);
    await this.validateState();
    try {
      await this._resolveTurnSetup();
    } catch (error) {
      if (error instanceof AgentHostPolicyChangedError) {
        current = await store.load(this._context.id) ?? current;
        await this._staleParkedApprovalBatch(current);
      }
      throw error;
    }
    current = await store.load(this._context.id);
    const requests = current?.snapshot.approvalLedger?.requests.filter(
      request => request.runId === this._context.turn.id
    ) ?? [];
    if (requests.some(request => request.state === "pending")) {
      throw new Error("Every tool approval in the batch must be decided first");
    }
    const last = this.messages.at(-1);
    if (last?.role !== "assistant") {
      throw new Error("Approved tool resume requires a trailing tool-call message");
    }
    const calls = last.content.filter(content => content.type === "toolCall");
    if (calls.length === 0) {
      throw new Error("Approved tool resume has no tool calls");
    }
    for (const call of calls) {
      const request = requests.find(item => item.toolCallId === call.id);
      if (!request) { continue; }
      if (request.state !== "approved" && request.state !== "denied") {
        throw new Error(`Tool approval ${request.id} cannot resume`);
      }
      current = await store.load(this._context.id);
      const operation = current?.snapshot.operationLedger?.steps
        .flatMap(step => step.operations)
        .find(item => item.id === request.operationId);
      if (!current || operation?.state !== "parked" || !operation.park) {
        throw new Error(`Tool approval ${request.id} is not ready to resume`);
      }
      if (request.state === "denied") {
        await this._durableOperations.cancelParkedToolCall({
          operationId: operation.id,
          parkId: operation.park.parkId,
          requestFingerprint: operation.requestFingerprint,
          resumeSchemaFingerprint: operation.park.resumeSchemaFingerprint
        });
      } else {
        await this._durableOperations.resumeParkedOperation({
          sessionId: this._context.id,
          runId: this._context.turn.id,
          expectedVersion: current.version,
          operationId: operation.id,
          parkId: operation.park.parkId,
          resumeSchemaFingerprint: operation.park.resumeSchemaFingerprint
        }, {
          name: call.name,
          arguments: call.arguments
        });
      }
    }
    this._approvalBatchPending = false;
    const results = await Promise.all(calls.map(async call => {
      const request = requests.find(item => item.toolCallId === call.id);
      if (request?.state === "denied") {
        return {
          role: "toolResult" as const,
          toolCallId: call.id,
          toolName: call.name,
          content: [{
            type: "text" as const,
            text: request.reason ?? "Tool call denied by the user; not run"
          }],
          details: { approval: "denied", notRun: true },
          isError: true,
          timestamp: Date.now()
        } satisfies ToolResultMessage;
      }
      const tool = this._toolPolicy.preparedTool(call.name);
      if (tool?.kind !== "executable") {
        throw new Error(`Approved tool ${call.name} is not executable`);
      }
      const outcome = await tool.execute(call.id, call.arguments);
      if (outcome.type !== "completed") {
        throw new Error(`Approved tool ${call.name} remained deferred`);
      }
      return {
        role: "toolResult" as const,
        toolCallId: call.id,
        toolName: call.name,
        content: outcome.result.content,
        details: outcome.result.details,
        isError: outcome.result.isError ?? false,
        timestamp: Date.now()
      } satisfies ToolResultMessage;
    }));
    const checkpoint = this._executionMode === "react";
    await this._sessionState.completeStep(results, {
      durableMutations: this._durableOperations.toolBatchMutations({ checkpoint })
    });
    this._durableOperations.markToolBatchCommitted({ checkpoint });
    await this.resolveToolResults(results);
    if (this._executionMode !== "manual") {
      await this.continue();
    }
  }

  async continue(): Promise<void> {
    this._terminalError = null;
    this._structuredOutput = null;
    await this.validateState();
    await this._resolveTurnSetup();
    if (await this._budget.parkIfReached()) { return; }
    await this._agent.continue();
    if (await this._budget.isWaiting()) { return; }
    this._assertStructuredOutputCompleted();
    this._throwTerminalError();
  }

  async compactContext(): Promise<boolean> {
    if (this._agent.state.isStreaming || this._compactionAbortController) {
      throw new Error("Cannot compact context while the session is running");
    }
    this._terminalError = null;
    await this.validateState();
    await this._resolveTurnSetup();
    const abortController = new AbortController();
    this._compactionAbortController = abortController;
    try {
      return await this._compaction.compactNow(
        this.messages,
        this._agent.state.model,
        this._agent.state.thinkingLevel,
        abortController.signal
      );
    } finally {
      this._compactionAbortController = null;
    }
  }

  abort(): void {
    this._sessionState.discardStep();
    this._compactionAbortController?.abort();
    this._agent.abort();
  }

  async waitForIdle(): Promise<void> {
    return this._agent.waitForIdle();
  }

  subscribe(
    listener: (event: AgentSessionEvent) => Promise<void> | void
  ): () => void {
    return this._eventProjector.subscribe(listener);
  }

  private _throwTerminalError(): void {
    const error = this._terminalError;
    this._terminalError = null;
    if (error) { throw error; }
  }

  private async _beforeToolCall(
    context: BeforeToolCallContext,
    signal?: AbortSignal
  ): Promise<{ block: true; reason: string; } | undefined> {
    const calls = context.assistantMessage.content.filter(
      content => content.type === "toolCall"
    );
    const finalCalls = calls.filter(
      call => call.name === STRUCTURED_OUTPUT_TOOL_NAME
    );
    if (finalCalls.length > 0 && (finalCalls.length !== 1 || calls.length !== 1)) {
      const error = new StructuredOutputError(
        "structured_output_invalid",
        "final_output must be called exactly once and without sibling tools"
      );
      this._terminalError = error;
      return { block: true, reason: error.message };
    }
    if (
      finalCalls.length > 0
      && !this._outputValidator?.Check(finalCalls[0]?.arguments)
    ) {
      const error = new StructuredOutputError(
        "structured_output_invalid",
        "final_output arguments do not match the selected contract"
      );
      this._terminalError = error;
      return { block: true, reason: error.message };
    }
    if (this._durableOperations.active && !signal?.aborted) {
      try {
        const tool = this._toolPolicy.preparedTool(context.toolCall.name);
        if (tool?.kind === "executable") {
          const approvalContext = {
            callId: context.toolCall.id,
            session: this._context,
            toolInput: context.args as Readonly<unknown>,
            toolName: context.toolCall.name
          };
          const sourceRequirement = await this._resolveApprovalRequirement(
            tool.approval ?? "never",
            approvalContext,
            "Source"
          );
          const hostRequirement = this._approvalPolicy
            ? await this._resolveApprovalRequirement(
              this._approvalPolicy.evaluate,
              approvalContext,
              "Host"
            )
            : "never";
          const requirement = sourceRequirement === "deny"
            ? sourceRequirement
            : hostRequirement === "deny"
              ? hostRequirement
              : sourceRequirement === "always" || hostRequirement === "always"
                ? "always"
                : sourceRequirement === "once" || hostRequirement === "once"
                  ? "once"
                  : "never";
          if (requirement !== "never") {
            const [currentPrincipalFingerprint, initiatorPrincipalFingerprint] =
              await Promise.all([
                fingerprintRuntimeApprovalPrincipal(this._context.auth.current),
                fingerprintRuntimeApprovalPrincipal(this._context.auth.initiator)
              ]);
            const contributionId = tool.provenance?.contributionId
              ?? `host-tool:${tool.definition.name}`;
            const sourcePolicyFingerprint =
              await fingerprintDurableOperationValue({
                agentSnapshotFingerprint: this._project.fingerprint,
                contributionId,
                toolName: tool.definition.name
              });
            const hostPolicyFingerprint =
              await fingerprintDurableOperationValue(
                this._approvalPolicy
                  ? { id: this._approvalPolicy.id }
                  : { id: "neutral-host-approval-policy" }
              );
            const stored = requirement === "once" && this._sessionStore
              ? await this._sessionStore.load(this._context.id)
              : null;
            const granted = stored?.snapshot.approvalLedger?.grants.some(grant =>
              grant.agentSnapshotFingerprint === this._project.fingerprint
              && grant.contributionId === contributionId
              && grant.toolName === tool.definition.name
              && grant.sourcePolicyFingerprint === sourcePolicyFingerprint
              && grant.hostPolicyFingerprint === hostPolicyFingerprint
              && grant.currentPrincipalFingerprint
              === currentPrincipalFingerprint
              && grant.initiatorPrincipalFingerprint
              === initiatorPrincipalFingerprint) ?? false;
            if (!granted) {
              await this._durableOperations.parkToolCallForApproval({
                agentSnapshotFingerprint: this._project.fingerprint,
                arguments: context.args,
                contributionId,
                currentPrincipalFingerprint,
                hostPolicyFingerprint,
                initiatorPrincipalFingerprint,
                name: context.toolCall.name,
                ...(requirement === "deny"
                  ? { denied: true, reason: this._approvalDenialReason }
                  : {}),
                scope: requirement === "once" ? "session" : "call",
                sourcePolicyFingerprint,
                sourceRequirement,
                hostRequirement,
                toolCallId: context.toolCall.id
              });
              if (requirement === "deny") {
                this._toolPolicy.denyCall(
                  context.toolCall.id,
                  this._approvalDenialReason
                );
                return undefined;
              }
              this._approvalBatchPending = true;
            }
          }
        }
        if (this._approvalBatchPending) { return undefined; }
      } catch (error) {
        const terminal = error instanceof Error
          ? error
          : new Error(String(error));
        this._terminalError = terminal;
        return { block: true, reason: terminal.message };
      }
    }
    return undefined;
  }

  private _assertStructuredOutputCompleted(): void {
    if (!this._outputTool || this._structuredOutput || this._terminalError) {
      return;
    }
    const last = this._agent.state.messages.at(-1);
    if (
      last?.role === "assistant"
      && (last.stopReason === "aborted" || last.stopReason === "error")
    ) {
      return;
    }
    this._terminalError = new StructuredOutputError(
      "structured_output_missing",
      "The model completed without the selected structured output"
    );
  }

  private async _resolveTurnSetup(): Promise<void> {
    if (!this._sessionStore && this._resolvedWithoutSessionStore) { return; }
    const stateScopeEnabled = this._executionMode !== "manual";
    const stored = this._sessionStore
      ? await this._sessionStore.load(this._sessionState.context.id)
      : null;
    const approvalWait = stored
      ? runtimeRunHasParkedToolApprovals(stored, this._context.turn.id)
      : false;
    if (approvalWait) {
      this._agent.state.messages = this._toolPolicy.restoreDeferredPlaceholders(
        this._agent.state.messages,
        this._executionMode,
        true
      );
    }
    const [instructionSnapshot, capabilities] = await Promise.all([
      this._instructions.prepare(stateScopeEnabled, stored),
      this._capabilities.prepare(stateScopeEnabled, stored)
    ]);
    if (
      !this._executionEnv
      && capabilities.tools.some(tool => tool.executionEnvToolKind)
    ) {
      throw new ExecutionEnvUnavailableError();
    }
    let committed = stored;
    const mutations = [];
    if (!stored?.snapshot.instructionSnapshots?.[
      this._sessionState.context.turn.id
    ]) {
      mutations.push({
        type: "recordTurnInstructions" as const,
        snapshot: instructionSnapshot
      });
    }
    if (!stored?.snapshot.capabilitySnapshots?.[
      this._sessionState.context.turn.id
    ]) {
      mutations.push({
        type: "recordTurnCapabilities" as const,
        snapshot: capabilities.snapshot
      });
    }
    if (this._sessionStore && mutations.length > 0) {
      committed = await this._sessionStore.commit({
        sessionId: this._sessionState.context.id,
        expectedVersion: stored?.version ?? null,
        mutations
      });
      await this._onSessionCommitted?.(committed);
    }
    this._instructionSnapshot = committed?.snapshot.instructionSnapshots?.[
      this._sessionState.context.turn.id
    ] ?? instructionSnapshot;
    this._capabilitySnapshot = committed?.snapshot.capabilitySnapshots?.[
      this._sessionState.context.turn.id
    ] ?? capabilities.snapshot;
    this._modelSelector = capabilities.model;
    this._reasoning = capabilities.reasoning;
    this._modelOptions = capabilities.modelOptions;
    if (capabilities.tools.some(tool =>
      tool.definition.name === STRUCTURED_OUTPUT_TOOL_NAME)) {
      throw new Error(
        `Runtime tool name "${STRUCTURED_OUTPUT_TOOL_NAME}" is reserved for structured output`
      );
    }
    const resolvedTools = this._outputTool
      ? [...capabilities.tools, this._outputTool]
      : capabilities.tools;
    this._toolPolicy.configure({
      tools: resolvedTools.map(tool => this._wrapApprovalBarrier(
        this._durableOperations.wrapTool(tool)
      ))
    });
    this._agent.state.model = resolveAgentRuntimeModel(
      this._models,
      capabilities.model
    );
    this._agent.state.thinkingLevel = capabilities.reasoning ?? "off";
    this._agent.state.tools = this._toolPolicy.toolsForMode(this._executionMode);
    this._agent.state.systemPrompt = this._instructionSnapshot.markdown;
    this._resolvedWithoutSessionStore = !this._sessionStore;
  }

  private _wrapApprovalBarrier(tool: PreparedAgentTool): PreparedAgentTool {
    if (tool.kind !== "executable") { return tool; }
    return {
      ...tool,
      execute: async (...args) => (this._approvalBatchPending
        ? { type: "deferred" }
        : tool.execute(...args))
    };
  }

  private _approvalDenialReason = "Tool execution denied by approval policy";

  private async _staleApprovalBatchIfIdentityChanged(
    current: StoredRuntimeSession
  ): Promise<void> {
    const requests = this._parkedApprovalRequests(current);
    if (requests.length === 0) { return; }
    const [
      currentPrincipalFingerprint,
      initiatorPrincipalFingerprint,
      hostPolicyFingerprint
    ] = await Promise.all([
      fingerprintRuntimeApprovalPrincipal(this._context.auth.current),
      fingerprintRuntimeApprovalPrincipal(this._context.auth.initiator),
      fingerprintDurableOperationValue(
        this._approvalPolicy
          ? { id: this._approvalPolicy.id }
          : { id: "neutral-host-approval-policy" }
      )
    ]);
    const changed = requests.some(request =>
      request.agentSnapshotFingerprint !== this._project.fingerprint
      || request.hostPolicyFingerprint !== hostPolicyFingerprint
      || request.currentPrincipalFingerprint !== currentPrincipalFingerprint
      || request.initiatorPrincipalFingerprint
      !== initiatorPrincipalFingerprint);
    if (changed) {
      await this._staleParkedApprovalBatch(current);
    }
  }

  private async _staleParkedApprovalBatch(
    current: StoredRuntimeSession
  ): Promise<never> {
    const store = this._sessionStore;
    if (!store) {
      throw new RuntimeToolApprovalStaleError();
    }
    const requests = this._parkedApprovalRequests(current);
    const operations = new Map(
      (current.snapshot.operationLedger?.steps ?? []).flatMap(step =>
        step.operations.map(operation => [operation.id, operation] as const))
    );
    const mutations: RuntimeSessionMutation[] = requests.flatMap(request => {
      const operation = operations.get(request.operationId);
      if (operation?.state !== "parked" || !operation.park) { return []; }
      return [
        {
          type: "staleToolApproval" as const,
          requestId: request.id,
          runId: request.runId
        },
        {
          type: "resumeOperation" as const,
          runId: request.runId,
          operationId: operation.id,
          parkId: operation.park.parkId,
          requestFingerprint: operation.requestFingerprint,
          resumeSchemaFingerprint: operation.park.resumeSchemaFingerprint
        },
        {
          type: "settleOperation" as const,
          runId: request.runId,
          operationId: operation.id,
          requestFingerprint: operation.requestFingerprint,
          state: "cancelled" as const
        }
      ];
    });
    if (mutations.length > 0) {
      const committed = await store.commit({
        sessionId: this._context.id,
        expectedVersion: current.version,
        mutations
      });
      await this._onSessionCommitted?.(committed);
    }
    throw new RuntimeToolApprovalStaleError();
  }

  private _parkedApprovalRequests(current: StoredRuntimeSession) {
    const parkedOperationIds = new Set(
      (current.snapshot.operationLedger?.steps ?? []).flatMap(step =>
        step.operations
          .filter(operation => operation.state === "parked")
          .map(operation => operation.id))
    );
    return (current.snapshot.approvalLedger?.requests ?? []).filter(request =>
      request.runId === this._context.turn.id
      && (request.state === "pending" || request.state === "approved")
      && parkedOperationIds.has(request.operationId));
  }

  private async _resolveApprovalRequirement(
    approval: Approval,
    context: ApprovalContext,
    owner: "Host" | "Source"
  ): Promise<"always" | "deny" | "never" | "once"> {
    try {
      const requirement = typeof approval === "function"
        ? await approval(context)
        : approval;
      if (!isApprovalRequirement(requirement)) {
        throw new TypeError(`${owner} approval policy returned an invalid decision`);
      }
      if (typeof requirement === "object") {
        this._approvalDenialReason = requirement.reason;
        return "deny";
      }
      return requirement;
    } catch {
      this._approvalDenialReason = `${owner} approval policy failed closed`;
      return "deny";
    }
  }
}
