import {
  InMemorySessionStore,
  recoverRuntimeSession,
  runtimeRunHasParkedToolApprovals
} from "@llm-space/runtime/harness";
import {
  type AgentHostApprovalPolicy,
  type AgentSubagentHost,
  type AgentSubagentRunStart,
  type AgentSubagentRunTerminal,
  type CompiledAgentProjectSnapshot,
  createHostCapabilityPolicy,
  type SandboxProvider,
  SandboxUnavailableError
} from "@llm-space/runtime/server";

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Models } from "@earendil-works/pi-ai";

import type {
  ServerSessionRepository,
  ServerSubagentRunRecord
} from "../repository/server-session-repository";

export function createServerAgentSubagentHost(options: {
  readonly approvalPolicy?: AgentHostApprovalPolicy;
  readonly models: Models;
  readonly project: CompiledAgentProjectSnapshot;
  readonly repository: ServerSessionRepository;
  readonly sandboxProvider?: SandboxProvider;
}): AgentSubagentHost {
  return {
    async prepare(start) {
      const subagent = options.project.subagents?.find(candidate =>
        candidate.id === start.subagent.id
        && candidate.project.artifact.fingerprint
        === start.subagent.artifactFingerprint);
      if (!subagent) {
        throw new Error("The frozen Server Subagent artifact is unavailable");
      }
      const definition = subagent.project.definition;
      if (!definition) { throw new Error("Subagent definition is unavailable"); }
      const prepared = await options.repository.createSubagentRun(
        start.parent.sessionId,
        async () => _createRecord(start, subagent.project)
      );
      _assertLineage(prepared.record, start);
      const resume = prepared.created
        ? { type: "prompt" as const }
        : await _resumeAction(options.repository, prepared.record);
      const current = await options.repository.loadSubagentRun(
        start.parent.sessionId,
        start.child.sessionId
      ) ?? prepared.record;
      const sandbox = start.sandbox.mode === "isolated"
        ? await _isolatedSandbox(
          options.sandboxProvider,
          subagent.project,
          start,
          !prepared.created
        )
        : undefined;
      return {
        ...(options.approvalPolicy
          ? { approvalPolicy: options.approvalPolicy }
          : {}),
        capabilityPolicy: createHostCapabilityPolicy({
          models: options.models,
          project: subagent.project
        }),
        initialMessages: current.transcript,
        persistence: {
          replaceMessages: async messages => {
            await options.repository.replaceSubagentTranscript(
              start.child.sessionId,
              messages
            );
          }
        },
        resume,
        sandbox,
        sessionStore: options.repository
      };
    },
    async park(identity, wait) {
      await options.repository.parkSubagentRun(identity.sessionId, wait.state);
    },
    async finish(identity, terminal) {
      await options.repository.finishSubagentRun(identity.sessionId, terminal);
    }
  };
}

async function _createRecord(
  start: AgentSubagentRunStart,
  project: CompiledAgentProjectSnapshot
): Promise<ServerSubagentRunRecord> {
  const definition = project.definition;
  if (!definition) { throw new Error("Subagent definition is unavailable"); }
  const store = new InMemorySessionStore();
  const runtime = await store.commit({
    sessionId: start.child.sessionId,
    expectedVersion: null,
    mutations: [{
      type: "startRun",
      runId: start.child.runId,
      messages: [],
      configuration: {
        id: `configuration-${start.subagent.artifactFingerprint}`,
        agentSnapshotFingerprint: project.fingerprint,
        contextFingerprint: `context-${start.child.sessionId}`,
        executionMode: "react",
        model: definition.model,
        ...(definition.limits ? { limits: definition.limits } : {}),
        ...(definition.reasoning ? { reasoning: definition.reasoning } : {}),
        toolConfigurationFingerprint: `tools-${project.fingerprint}`
      }
    }]
  });
  return {
    artifactFingerprint: start.subagent.artifactFingerprint,
    child: start.child,
    description: start.subagent.description,
    message: start.message,
    parent: start.parent,
    runtime,
    sandbox: start.sandbox,
    status: "running",
    subagentId: start.subagent.id,
    transcript: []
  };
}

async function _resumeAction(
  repository: ServerSessionRepository,
  record: ServerSubagentRunRecord
): Promise<NonNullable<
  Awaited<ReturnType<AgentSubagentHost["prepare"]>>["resume"]
>> {
  if (record.terminal) {
    return { type: "terminal", terminal: record.terminal };
  }
  const recovery = await recoverRuntimeSession(
    repository,
    record.child.sessionId
  );
  if (recovery.status === "outcomeUnknown") {
    return _terminal(repository, record, {
      status: "outcomeUnknown",
      error: {
        code: "subagent_outcome_unknown",
        message: "Subagent outcome is unknown; retry explicitly to run it again."
      }
    });
  }
  const current = await repository.load(record.child.sessionId);
  const run = current?.snapshot.runs.find(
    candidate => candidate.id === record.child.runId
  );
  if (!current || !run) { throw new Error("Server Subagent Runtime Run is missing"); }
  const operations = current.snapshot.operationLedger?.steps
    .filter(step => step.runId === run.id)
    .flatMap(step => step.operations) ?? [];
  if (
    record.transcript.length === 0
    && operations.length === 0
    && run.state === "runningModel"
  ) {
    return { type: "prompt" };
  }
  if (
    recovery.status === "parked"
    && runtimeRunHasParkedToolApprovals(recovery.session, run.id)
  ) {
    const pending = current.snapshot.approvalLedger?.requests.some(request =>
      request.runId === run.id && request.state === "pending") ?? false;
    return pending
      ? { type: "park", wait: { state: "waitingForApproval" } }
      : { type: "resumeApprovedTools" };
  }
  if (run.state === "completed") {
    return _terminal(repository, record, {
      status: "completed",
      result: _finalText(record.transcript)
    });
  }
  if (
    run.state === "cancelled"
    || run.state === "failed"
    || run.state === "outcomeUnknown"
    || run.state === "superseded"
  ) {
    const status = run.state === "superseded" ? "cancelled" : run.state;
    return _terminal(repository, record, {
      status,
      error: {
        code: `subagent_${status}`,
        message: `Subagent ended with ${status}.`
      }
    });
  }
  if (run.state === "waitingForApproval") {
    const pending = current.snapshot.approvalLedger?.requests.some(request =>
      request.runId === run.id && request.state === "pending") ?? false;
    return pending
      ? { type: "park", wait: { state: "waitingForApproval" } }
      : { type: "resumeApprovedTools" };
  }
  if (
    run.state === "waitingForBudget"
    || run.state === "waitingForToolResults"
  ) {
    return { type: "park", wait: { state: run.state } };
  }
  if (run.state === "waitingForContinue") { return { type: "continue" }; }
  return { type: "continue" };
}

async function _terminal(
  repository: ServerSessionRepository,
  record: ServerSubagentRunRecord,
  terminal: AgentSubagentRunTerminal
): Promise<{
  readonly terminal: AgentSubagentRunTerminal;
  readonly type: "terminal";
}> {
  await repository.finishSubagentRun(record.child.sessionId, terminal);
  return { type: "terminal", terminal };
}

async function _isolatedSandbox(
  provider: SandboxProvider | undefined,
  project: CompiledAgentProjectSnapshot,
  start: AgentSubagentRunStart,
  expectedExisting: boolean
) {
  if (!provider) {
    throw new SandboxUnavailableError(
      "The Subagent requires Sandbox but this Server Host has no SandboxProvider"
    );
  }
  const session = await provider.acquire({
    expectedExisting,
    seed: project.sandbox?.workspace ?? [],
    sessionId: start.child.sessionId
  });
  return {
    executionEnv: session.executionEnv,
    revalidationFingerprint: start.sandbox.revalidationFingerprint,
    workspaceManifest: await session.workspaceManifest()
  };
}

function _finalText(messages: readonly AgentMessage[]): string {
  const last = [...messages].reverse().find(message => message.role === "assistant");
  const text = last?.role === "assistant"
    ? last.content
      .filter(content => content.type === "text")
      .map(content => content.text)
      .join("")
      .trim()
    : "";
  if (!text) { throw new Error("Completed Subagent has no final text"); }
  return text;
}

function _assertLineage(
  record: ServerSubagentRunRecord,
  start: AgentSubagentRunStart
): void {
  if (
    record.artifactFingerprint !== start.subagent.artifactFingerprint
    || record.subagentId !== start.subagent.id
    || record.message !== start.message
    || JSON.stringify(record.parent) !== JSON.stringify(start.parent)
  ) {
    throw new Error("Persisted Server Subagent lineage changed");
  }
}
