import {
  convertFromPiMessages,
  convertToPiContext
} from "@llm-space/core";
import {
  InMemorySessionStore,
  recoverRuntimeSession,
  runtimeRunHasParkedToolApprovals,
  type SessionStore,
  type StoredRuntimeSession
} from "@llm-space/runtime/harness";
import {
  type AgentSubagentHost,
  type AgentSubagentRunIdentity,
  type AgentSubagentRunStart,
  type AgentSubagentRunTerminal,
  type CompiledAgentProjectSnapshot,
  createHostCapabilityPolicy,
  type SandboxTurnEnvironment
} from "@llm-space/runtime/node";

import type { AgentMessage, StreamFn } from "@earendil-works/pi-agent-core";
import type { Models } from "@earendil-works/pi-ai";

import type {
  ExternalAgentProjectSubagentRun
} from "../../shared/external-agent-project";

export interface DesktopAgentSubagentRecordAdapter {
  create(
    identity: AgentSubagentRunIdentity,
    create: () => Promise<ExternalAgentProjectSubagentRun>
  ): Promise<{
    readonly created: boolean;
    readonly record: ExternalAgentProjectSubagentRun;
  }>;
  load(
    identity: AgentSubagentRunIdentity
  ): Promise<ExternalAgentProjectSubagentRun | null>;
  update(
    identity: AgentSubagentRunIdentity,
    update: (
      current: ExternalAgentProjectSubagentRun
    ) => ExternalAgentProjectSubagentRun | Promise<ExternalAgentProjectSubagentRun>
  ): Promise<ExternalAgentProjectSubagentRun>;
}

export function createDesktopAgentSubagentHost(options: {
  readonly models: Models;
  readonly onSessionCommitted?: (
    identity: AgentSubagentRunIdentity,
    session: StoredRuntimeSession
  ) => Promise<void> | void;
  readonly prepareSandbox?: (
    start: AgentSubagentRunStart,
    project: CompiledAgentProjectSnapshot
  ) => Promise<SandboxTurnEnvironment>;
  readonly records: DesktopAgentSubagentRecordAdapter;
  readonly resolveProject: (
    start: AgentSubagentRunStart
  ) => Promise<CompiledAgentProjectSnapshot>;
  readonly streamFn?: StreamFn;
}): AgentSubagentHost {
  return {
    async prepare(start) {
      const project = await options.resolveProject(start);
      const prepared = await options.records.create(
        start.child,
        async () => _createRecord(start, project)
      );
      _assertRecordMatchesStart(prepared.record, start);
      const sessionStore = createDesktopAgentSubagentSessionStore(
        options.records,
        start.child,
        options.onSessionCommitted
      );
      const resume = prepared.created
        ? { type: "prompt" as const }
        : await _resumeAction(
          options.records,
          prepared.record,
          sessionStore
        );
      const current = await options.records.load(start.child)
        ?? prepared.record;
      const sandbox = start.sandbox.mode === "isolated"
        ? await options.prepareSandbox?.(start, project)
        : undefined;
      if (resume.type !== "park" && resume.type !== "terminal") {
        await options.records.update(start.child, record => ({
          ...record,
          status: "running",
          updatedAt: new Date().toISOString()
        }));
      }
      return {
        capabilityPolicy: createHostCapabilityPolicy({
          models: options.models,
          project
        }),
        initialMessages: _piMessages(current),
        persistence: {
          replaceMessages: async messages => {
            await options.records.update(start.child, record => ({
              ...record,
              messages: convertFromPiMessages(
                messages,
                [...record.messages]
              ),
              updatedAt: new Date().toISOString()
            }));
          }
        },
        resume,
        sandbox,
        sessionStore,
        streamFn: options.streamFn
      };
    },
    async park(identity, wait) {
      await options.records.update(identity, record => ({
        ...record,
        status: wait.state,
        updatedAt: new Date().toISOString()
      }));
    },
    async finish(identity, terminal) {
      await options.records.update(identity, record => ({
        ...record,
        status: terminal.status,
        terminal,
        updatedAt: new Date().toISOString()
      }));
    }
  };
}

async function _createRecord(
  start: AgentSubagentRunStart,
  project: CompiledAgentProjectSnapshot
): Promise<ExternalAgentProjectSubagentRun> {
  const definition = project.definition;
  if (!definition) { throw new Error("Subagent has no compiled definition."); }
  const store = new InMemorySessionStore();
  const runtimeSession = await store.commit({
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
  const now = new Date().toISOString();
  return {
    artifactFingerprint: start.subagent.artifactFingerprint,
    capabilities: [
      ...project.tools.map(tool => ({
        kind: "tool" as const,
        name: tool.name,
        sourcePath: tool.sourcePath ?? `tools/${tool.name}.ts`
      })),
      ...(project.resources.skills ?? []).map(skill => ({
        kind: "skill" as const,
        name: skill.name,
        sourcePath: `skills/${skill.name}/SKILL.md`
      }))
    ],
    child: start.child,
    createdAt: now,
    description: start.subagent.description,
    instructions: project.instructions,
    limits: definition.limits ?? null,
    message: start.message,
    messages: [],
    model: definition.model,
    parent: start.parent,
    ...(start.retryOf ? { retryOf: start.retryOf } : {}),
    runtimeSession,
    sandbox: start.sandbox,
    schemaVersion: 1,
    status: "preparing",
    subagentId: start.subagent.id,
    updatedAt: now
  };
}

export function createDesktopAgentSubagentSessionStore(
  records: DesktopAgentSubagentRecordAdapter,
  identity: AgentSubagentRunIdentity,
  onCommitted?: (
    identity: AgentSubagentRunIdentity,
    session: StoredRuntimeSession
  ) => Promise<void> | void
): SessionStore {
  return {
    async load(sessionId) {
      if (sessionId !== identity.sessionId) { return null; }
      const record = await records.load(identity);
      if (!record) { return null; }
      return new InMemorySessionStore([record.runtimeSession]).load(sessionId);
    },
    async commit(input) {
      if (input.sessionId !== identity.sessionId) {
        throw new Error("Subagent Session Store identity changed.");
      }
      let committed: StoredRuntimeSession | null = null;
      await records.update(identity, async record => {
        const store = new InMemorySessionStore([record.runtimeSession]);
        committed = await store.commit(input);
        return {
          ...record,
          runtimeSession: committed,
          status: _recordStatus(committed, identity.runId),
          updatedAt: new Date().toISOString()
        };
      });
      if (!committed) {
        throw new Error("Subagent Runtime Session commit was not persisted.");
      }
      await onCommitted?.(identity, committed);
      return committed;
    }
  };
}

async function _resumeAction(
  records: DesktopAgentSubagentRecordAdapter,
  record: ExternalAgentProjectSubagentRun,
  store: SessionStore
): Promise<NonNullable<
  Awaited<ReturnType<AgentSubagentHost["prepare"]>>["resume"]
>> {
  if (record.terminal) {
    return { type: "terminal", terminal: record.terminal };
  }
  const recovery = await recoverRuntimeSession(store, record.child.sessionId);
  if (recovery.status === "outcomeUnknown") {
    const terminal = {
      status: "outcomeUnknown" as const,
      error: {
        code: "subagent_outcome_unknown",
        message: "Subagent outcome is unknown; retry explicitly to run it again."
      }
    };
    await _persistRecoveredTerminal(records, record.child, terminal);
    return { type: "terminal", terminal };
  }
  if (recovery.status === "cancelled") {
    const terminal = {
      status: "cancelled" as const,
      error: { code: "subagent_cancelled", message: "Subagent was cancelled." }
    };
    await _persistRecoveredTerminal(records, record.child, terminal);
    return { type: "terminal", terminal };
  }
  const current = await store.load(record.child.sessionId);
  const run = current?.snapshot.runs.find(
    candidate => candidate.id === record.child.runId
  );
  if (!current || !run) { throw new Error("Subagent Runtime Run is missing."); }
  const operations = current.snapshot.operationLedger?.steps
    .filter(step => step.runId === run.id)
    .flatMap(step => step.operations) ?? [];
  if (
    record.messages.length === 0
    && operations.length === 0
    && run.state === "runningModel"
  ) {
    return { type: "prompt" };
  }
  if (
    recovery.status === "parked"
    && runtimeRunHasParkedToolApprovals(recovery.session, run.id)
  ) {
    const hasPending = current.snapshot.approvalLedger?.requests.some(
      request => request.runId === run.id && request.state === "pending"
    ) ?? false;
    return hasPending
      ? { type: "park", wait: { state: "waitingForApproval" } }
      : { type: "resumeApprovedTools" };
  }
  if (run.state === "completed") {
    const result = _finalText(record.messages);
    const terminal = { status: "completed" as const, result };
    await _persistRecoveredTerminal(records, record.child, terminal);
    return { type: "terminal", terminal };
  }
  if (
    run.state === "failed"
    || run.state === "cancelled"
    || run.state === "outcomeUnknown"
    || run.state === "superseded"
  ) {
    const terminal = {
      status: run.state === "superseded" ? "cancelled" as const : run.state,
      error: {
        code: `subagent_${_snakeCase(run.state)}`,
        message: `Subagent ended with ${run.state}.`
      }
    };
    await _persistRecoveredTerminal(records, record.child, terminal);
    return { type: "terminal", terminal };
  }
  if (run.state === "waitingForApproval") {
    const hasPending = current.snapshot.approvalLedger?.requests.some(
      request => request.runId === run.id && request.state === "pending"
    ) ?? false;
    return hasPending
      ? { type: "park", wait: { state: "waitingForApproval" } }
      : { type: "resumeApprovedTools" };
  }
  if (
    run.state === "waitingForBudget"
    || run.state === "waitingForToolResults"
  ) {
    return { type: "park", wait: { state: run.state } };
  }
  if (run.state === "waitingForContinue") {
    return { type: "continue" };
  }
  return { type: "continue" };
}

async function _persistRecoveredTerminal(
  records: DesktopAgentSubagentRecordAdapter,
  identity: AgentSubagentRunIdentity,
  terminal: AgentSubagentRunTerminal
): Promise<void> {
  await records.update(identity, record => ({
    ...record,
    status: terminal.status,
    terminal,
    updatedAt: new Date().toISOString()
  }));
}

function _recordStatus(
  session: StoredRuntimeSession,
  runId: string
): ExternalAgentProjectSubagentRun["status"] {
  const state = session.snapshot.runs.find(run => run.id === runId)?.state;
  if (!state) { throw new Error("Subagent Runtime Run is missing."); }
  if (state === "runningModel" || state === "runningTools") { return "running"; }
  return state === "superseded" ? "cancelled" : state;
}

function _piMessages(record: ExternalAgentProjectSubagentRun): AgentMessage[] {
  return convertToPiContext({
    messages: [...record.messages],
    systemPrompt: "",
    tools: []
  }).messages as AgentMessage[];
}

function _finalText(
  messages: ExternalAgentProjectSubagentRun["messages"]
): string {
  const last = [...messages].reverse().find(message => message.role === "assistant");
  const text = last?.role === "assistant"
    ? last.content
      .filter(content => content.type === "text")
      .map(content => content.text)
      .join("")
      .trim()
    : "";
  if (!text) { throw new Error("Completed Subagent has no final text."); }
  return text;
}

function _assertRecordMatchesStart(
  record: ExternalAgentProjectSubagentRun,
  start: AgentSubagentRunStart
): void {
  if (
    record.artifactFingerprint !== start.subagent.artifactFingerprint
    || record.subagentId !== start.subagent.id
    || record.message !== start.message
    || JSON.stringify(record.parent) !== JSON.stringify(start.parent)
  ) {
    throw new Error("Persisted Subagent lineage does not match delegation.");
  }
}

function _snakeCase(value: string): string {
  return value.replaceAll(/([a-z])([A-Z])/g, "$1_$2").toLowerCase();
}
