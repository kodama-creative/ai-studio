import type { AgentMessage, StreamFn } from "@earendil-works/pi-agent-core";
import type { Models } from "@earendil-works/pi-ai";

import { AgentRuntime } from "./agent-runtime";
import { runtimeRunHasParkedToolApprovals } from "../harness/runtime-tool-approval-view";

import type { CompiledAgentSubagent } from "./agent-project-snapshot";
import type {
  AgentSubagentHost,
  AgentSubagentRunIdentity,
  AgentSubagentRunStart,
  AgentSubagentRunTerminal
} from "./agent-subagent-host";
import type { PreparedAgentTool } from "./prepared-agent-tool";
import type { AgentSessionContext } from "../../shared/agent-session-context";
import type { SessionStore } from "../harness/session-store";
import type { SandboxTurnEnvironment } from "../sandbox/sandbox-provider";

export function createAgentSubagentTool(input: {
  readonly context: AgentSessionContext;
  readonly host: AgentSubagentHost;
  readonly models: Models;
  readonly parentSandbox?: SandboxTurnEnvironment;
  readonly parentSandboxFingerprint?: string;
  readonly streamFn?: StreamFn;
  readonly subagent: CompiledAgentSubagent;
}): PreparedAgentTool {
  return {
    kind: "executable",
    definition: {
      name: input.subagent.id,
      label: input.subagent.id,
      description: input.subagent.description,
      parameters: {
        type: "object",
        properties: {
          message: {
            type: "string",
            description: "Everything the child needs; it cannot see parent history."
          }
        },
        required: ["message"],
        additionalProperties: false
      }
    },
    provenance: {
      contributionId: `subagent:${input.subagent.id}`,
      sourcePath: `subagents/${input.subagent.id}/agent.ts`
    },
    async execute(toolCallId, value, signal) {
      const message = _message(value);
      const identity = await _identity({
        artifactFingerprint: input.subagent.project.artifact.fingerprint,
        parentRunId: input.context.turn.id,
        parentSessionId: input.context.id,
        subagentId: input.subagent.id,
        toolCallId
      });
      const sandbox = _sandboxSelection({
        childFingerprint:
          input.subagent.project.sandbox?.revalidationFingerprint,
        parent: input.parentSandbox,
        parentFingerprint: input.parentSandbox?.revalidationFingerprint
          ?? input.parentSandboxFingerprint
      });
      const start: AgentSubagentRunStart = {
        child: identity,
        message,
        parent: {
          sessionId: input.context.id,
          runId: input.context.turn.id,
          toolCallId
        },
        sandbox: {
          mode: sandbox.mode,
          ...(sandbox.fingerprint
            ? { revalidationFingerprint: sandbox.fingerprint }
            : {})
        },
        subagent: {
          id: input.subagent.id,
          description: input.subagent.description,
          artifactFingerprint: input.subagent.project.artifact.fingerprint
        }
      };
      const childContext: AgentSessionContext = {
        id: identity.sessionId,
        auth: structuredClone(input.context.auth),
        channel: structuredClone(input.context.channel),
        turn: { id: identity.runId, sequence: 1 }
      };
      let unsubscribe = () => {};
      let removeAbort = () => {};
      try {
        const resources = await input.host.prepare(start, childContext);
        if (resources.resume?.type === "terminal") {
          return _toolOutcome(
            identity,
            input.subagent.id,
            resources.resume.terminal
          );
        }
        if (resources.resume?.type === "park") {
          await input.host.park?.(identity, resources.resume.wait);
          return { type: "deferred" };
        }
        const childSandbox = sandbox.mode === "shared"
          ? input.parentSandbox
          : resources.sandbox;
        const runtime = new AgentRuntime({
          models: input.models,
          project: input.subagent.project
        });
        const session = await runtime.createSession({
          context: childContext,
          capabilityPolicy: resources.capabilityPolicy,
          executionMode: "react",
          initialMessages: resources.initialMessages
            ? structuredClone(resources.initialMessages) as AgentMessage[]
            : [],
          approvalPolicy: resources.approvalPolicy,
          extraTools: resources.extraTools,
          executionEnv: resources.executionEnv,
          onSessionCommitted: resources.onSessionCommitted,
          persistence: resources.persistence,
          sessionStore: resources.sessionStore,
          streamFn: resources.streamFn ?? input.streamFn,
          ...(childSandbox ? { sandbox: childSandbox } : {})
        });
        unsubscribe = session.subscribe(async event =>
          input.host.handleEvent?.(identity, event));
        const abort = () => { session.abort(); };
        signal?.addEventListener("abort", abort, { once: true });
        removeAbort = () => { signal?.removeEventListener("abort", abort); };
        if (signal?.aborted) { session.abort(); }
        const resume = resources.resume ?? { type: "prompt" as const };
        if (resume.type === "prompt") {
          await session.prompt(message);
        } else if (resume.type === "resumeApprovedTools") {
          await session.resumeApprovedTools();
        } else if (resume.type === "resolveToolResults") {
          await session.resolveToolResults([...resume.results]);
          await session.continue();
        } else {
          await session.continue();
        }
        const wait = await _waitState(
          resources.sessionStore,
          identity.sessionId,
          identity.runId
        );
        if (wait) {
          await input.host.park?.(identity, { state: wait });
          return { type: "deferred" };
        }
        const result = _finalText(session.messages);
        await input.host.finish?.(identity, { status: "completed", result });
        return _toolOutcome(identity, input.subagent.id, {
          status: "completed",
          result
        });
      } catch (error) {
        const cancelled = signal?.aborted === true;
        const terminal = {
          status: cancelled ? "cancelled" as const : "failed" as const,
          error: {
            code: cancelled ? "subagent_cancelled" : "subagent_failed",
            message: _errorMessage(error)
          }
        };
        await input.host.finish?.(identity, terminal);
        return _toolOutcome(identity, input.subagent.id, terminal);
      } finally {
        removeAbort();
        unsubscribe();
      }
    }
  };
}

async function _identity(input: {
  readonly artifactFingerprint: string;
  readonly parentRunId: string;
  readonly parentSessionId: string;
  readonly subagentId: string;
  readonly toolCallId: string;
}): Promise<AgentSubagentRunIdentity> {
  const bytes = new TextEncoder().encode(JSON.stringify([
    "agent-subagent-v1",
    input.parentSessionId,
    input.parentRunId,
    input.toolCallId,
    input.subagentId,
    input.artifactFingerprint
  ]));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  const fingerprint = [...new Uint8Array(digest)]
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
  return {
    sessionId: `subagent-session-${fingerprint}`,
    runId: `subagent-run-${fingerprint}`
  };
}

function _toolOutcome(
  identity: AgentSubagentRunIdentity,
  subagentId: string,
  terminal: AgentSubagentRunTerminal
): Awaited<ReturnType<Extract<PreparedAgentTool, { kind: "executable"; }>["execute"]>> {
  if (terminal.status === "completed" && terminal.result === undefined) {
    throw new Error("Completed Subagent terminal requires final text");
  }
  const text = terminal.result ?? terminal.error?.message ?? terminal.status;
  return {
    type: "completed",
    result: {
      content: [{ type: "text", text }],
      details: {
        type: "subagent",
        childSessionId: identity.sessionId,
        childRunId: identity.runId,
        subagentId,
        ...(terminal.error ? { errorCode: terminal.error.code } : {}),
        terminalStatus: terminal.status
      },
      ...(terminal.status === "completed" ? {} : { isError: true })
    }
  };
}

function _sandboxSelection(input: {
  readonly childFingerprint?: string;
  readonly parent?: SandboxTurnEnvironment;
  readonly parentFingerprint?: string;
}): {
  readonly fingerprint?: string;
  readonly mode: "direct" | "isolated" | "shared";
} {
  if (!input.childFingerprint) {
    return input.parent
      ? { mode: "shared", fingerprint: input.parentFingerprint }
      : { mode: "direct" };
  }
  if (
    input.parent
    && input.parentFingerprint === input.childFingerprint
  ) {
    return { mode: "shared", fingerprint: input.childFingerprint };
  }
  return { mode: "isolated", fingerprint: input.childFingerprint };
}

function _message(value: unknown): string {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || Object.keys(value).length !== 1
    || typeof (value as { message?: unknown; }).message !== "string"
    || (value as { message: string; }).message.trim().length === 0
  ) {
    throw new TypeError("Subagent input must be { message: non-empty string }");
  }
  return (value as { message: string; }).message;
}

function _finalText(messages: readonly AgentMessage[]): string {
  const last = [...messages].reverse().find(message => message.role === "assistant");
  if (last?.role !== "assistant") {
    throw new Error("Subagent completed without a final assistant response");
  }
  const text = last.content
    .filter(content => content.type === "text")
    .map(content => content.text)
    .join("")
    .trim();
  if (!text) {
    throw new Error("Subagent completed without final text");
  }
  return text;
}

function _errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function _waitState(
  store: SessionStore | undefined,
  sessionId: string,
  runId: string
): Promise<
  | "waitingForApproval"
  | "waitingForBudget"
  | "waitingForContinue"
  | "waitingForToolResults"
  | null
> {
  const stored = await store?.load(sessionId);
  if (stored && runtimeRunHasParkedToolApprovals(stored, runId)) {
    return "waitingForApproval";
  }
  const state = stored?.snapshot.runs.find(run => run.id === runId)?.state;
  return state === "waitingForApproval"
    || state === "waitingForBudget"
    || state === "waitingForContinue"
    || state === "waitingForToolResults"
    ? state
    : null;
}
