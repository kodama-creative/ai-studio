import { createHash } from "node:crypto";
import {
  AgentHostPolicyChangedError,
  AgentRuntime,
  AgentStateCommitUnknownError,
  type CompiledAgentProjectSnapshot,
  createHostCapabilityPolicy,
  ExecutionEnvUnavailableError,
  StructuredOutputError
} from "@llm-space/runtime/server";

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Models, UserMessage } from "@earendil-works/pi-ai";
import type { AgentCapabilityPolicy } from "@llm-space/runtime";
import type { RuntimeStructuredOutputResult } from "@llm-space/runtime/harness";

import { ServerCapacityError } from "./server-capacity-error";
import { serializePiAgentEvent } from "../protocol/pi-event-serializer";
import { ServerEventTooLargeError } from "../repository/server-event-too-large-error";

import type { ServerPrincipal } from "../auth/server-authenticator";
import type {
  CreatedServerRun,
  ServerRunTerminalOutcome,
  ServerSessionRepository
} from "../repository/server-session-repository";

export interface ServerRunControllerOptions {
  readonly maxActiveRuns?: number;
  readonly maxStructuredOutputBytes?: number;
  readonly models: Models;
  readonly project: CompiledAgentProjectSnapshot;
  readonly repository: ServerSessionRepository;
}

export class ServerRunController {
  private readonly _runtime: AgentRuntime;
  private readonly _capabilityPolicy: AgentCapabilityPolicy;
  private readonly _repository: ServerSessionRepository;
  private readonly _active = new Map<string, { abort(): void; }>();
  private readonly _abortedRuns = new Set<string>();
  private readonly _pendingRuns = new Set<string>();
  private readonly _executions = new Set<Promise<void>>();
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
    if (!this._runtime.defaultModel.available) {
      throw new Error("Compiled Agent default model is unavailable");
    }
    this._repository = options.repository;
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
  }): Promise<CreatedServerRun> {
    const result = this._creationTail.then(async () => this._createRun(input));
    this._creationTail = result.then(() => {}, () => {});
    return result;
  }

  private async _createRun(input: {
    readonly continuationToken: string;
    readonly idempotencyKey: string;
    readonly outputContract?: string;
    readonly owner: ServerPrincipal;
    readonly sessionId: string;
    readonly text: string;
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
      ...this._repository.authorizedTranscript(input),
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
        this._pendingRuns.add(created.runId);
        const execution = this._execute(created);
        this._executions.add(execution);
        void execution.then(
          () => { this._executions.delete(execution); },
          () => { this._executions.delete(execution); }
        );
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
    try {
      const session = await this._runtime.createSession({
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
        ...(run.outputContract ? { outputContract: run.outputContract } : {}),
        persistence: {
          replaceMessages: async messages => {
            if (!this._detached) {
              await this._repository.replaceTranscript(run.sessionId, messages);
            }
          }
        }
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
            throw new Error("Server ReAct mode cannot defer tool calls");
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
        await session.continue();
        structuredOutput = session.structuredOutput ?? undefined;
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
      if (this._abortedRuns.has(run.runId)) {
        outcome = "cancelled";
      } else if (error instanceof AgentStateCommitUnknownError) {
        outcome = "outcomeUnknown";
        code = "session_state_commit_unknown";
      } else if (error instanceof AgentHostPolicyChangedError) {
        outcome = "failed";
        code = "hostPolicyChanged";
      } else if (error instanceof ExecutionEnvUnavailableError) {
        outcome = "failed";
        code = "executionEnvUnavailable";
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
        if (!this._detached) {
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
      }
    }
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
