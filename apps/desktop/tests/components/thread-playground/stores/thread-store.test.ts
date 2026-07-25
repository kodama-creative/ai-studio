import {
  InMemorySessionStore,
  runtimeHistoryMessages,
  type RuntimeJsonValue,
  type StoredRuntimeSession
} from "@llm-space/runtime/harness";
import { expect, mock, test } from "bun:test";

import type { AgentEvent, AgentTransport, Thread } from "@llm-space/core";

import { ThreadRuntimeSession } from "@/components/thread-playground/stores/thread-runtime-session";

void mock.module("@/lib/electrobun", () => ({ electrobun: { rpc: null } }));
globalThis.requestAnimationFrame = callback =>
  setTimeout(() => { callback(performance.now()); }, 0) as unknown as number;
globalThis.cancelAnimationFrame = handle => {
  clearTimeout(handle);
};

const INVALID_THREAD: Thread = {
  model: { provider: "fake", id: "model" },
  context: {
    messages: [
      {
        id: "user-one",
        role: "user",
        content: [{ type: "text", text: "Question" }]
      },
      {
        id: "assistant-one",
        role: "assistant",
        content: [{ type: "text", text: "Answer" }]
      }
    ]
  }
};

test("scopes invalid Run feedback to the blocking message", async () => {
  const { createThreadStore } = await import(
    "@/components/thread-playground/stores"
  );
  let transportCalls = 0;
  const store = createThreadStore(INVALID_THREAD, {
    transport: () => {
      transportCalls += 1;
      throw new Error("Transport should not run for invalid input");
    },
    resolveModel: saved => saved ?? null
  });

  await store.getState().run();

  expect(store.getState().runValidationIssue).toMatchObject({
    code: "lastAssistantMessage",
    level: "warning",
    messageId: "assistant-one",
    resolution: { type: "appendUserMessage" }
  });
  expect(transportCalls).toBe(0);

  store.getState().updateMessageTextContent("assistant-one", "Edited answer");
  expect(store.getState().runValidationIssue?.messageId).toBe("assistant-one");

  store.getState().resolveRunValidationIssue();
  expect(store.getState().runValidationIssue).toBeNull();
  expect(store.getState().thread.context?.messages?.at(-1)?.role).toBe("user");
  expect(store.getState().autoFocusMessageId).toBe(
    store.getState().thread.context?.messages?.at(-1)?.id ?? null
  );
});

test("clears invalid Run feedback when the blocking role becomes runnable", async () => {
  const { createThreadStore } = await import(
    "@/components/thread-playground/stores"
  );
  const store = createThreadStore(INVALID_THREAD, {
    transport: () => {
      throw new Error("Transport should not run for invalid input");
    },
    resolveModel: saved => saved ?? null
  });

  await store.getState().run();
  store.getState().toggleMessageRole("assistant-one");

  expect(store.getState().runValidationIssue).toBeNull();
});

test("settles Compact now without a model event or new checkpoint", async () => {
  const { createThreadStore } = await import(
    "@/components/thread-playground/stores"
  );
  const initial = _initialRuntimeThread();
  const runtime = new ThreadRuntimeSession(undefined);
  const begun = await runtime.begin({
    thread: initial,
    context: initial.context ?? {},
    executionMode: "react",
    model: initial.model!
  });
  const completedThread: Thread = {
    ...initial,
    context: {
      ...initial.context,
      messages: [
        ...(initial.context?.messages ?? []),
        {
          id: "assistant-done",
          role: "assistant",
          content: [{ type: "text", text: "Done" }]
        }
      ]
    }
  };
  const settled = await runtime.settle({
    thread: completedThread,
    context: completedThread.context ?? {},
    executionMode: "react",
    model: completedThread.model!,
    runId: begun.runId,
    sawEvent: true,
    outcome: "completed"
  });
  if (!settled.checkpoint) {
    throw new Error("Expected a settled checkpoint");
  }
  expect(settled.session.snapshot.activeRunId).toBeNull();
  expect(settled.session.snapshot.history.currentBranchId).toBe(
    settled.checkpoint.branchId ?? null
  );
  expect(settled.session.snapshot.history.currentCheckpointId).toBe(
    settled.checkpoint.checkpointId ?? null
  );
  let persisted: Thread = {
    ...completedThread,
    runtimeSession: settled.session,
    runtimeWorkingBase: {
      sessionId: settled.session.snapshot.id,
      branchId: settled.checkpoint.branchId!,
      checkpointId: settled.checkpoint.checkpointId!
    }
  };
  let action: string | undefined;
  const transport: AgentTransport = async function* transport(request) {
    action = request.action;
    yield* [] as AgentEvent[];
  };
  const store = createThreadStore(persisted, {
    transport,
    resolveModel: saved => saved ?? null,
    runtimeOwnsToolLoop: true,
    persistSettledThread: async thread => {
      persisted = structuredClone(thread);
    }
  });
  expect(store.getState().thread.runtimeWorkingBase).toEqual(
    persisted.runtimeWorkingBase
  );

  await store.getState().compactNow();

  const session = persisted.runtimeSession as StoredRuntimeSession;
  expect(action).toBe("compact");
  expect(session.snapshot.runs).toHaveLength(2);
  expect(session.snapshot.runs.at(-1)?.state).toBe("completed");
  expect(session.snapshot.history.checkpoints).toHaveLength(1);
  expect(persisted.runHistory ?? []).toHaveLength(0);
  expect(persisted.context?.messages).toEqual(
    completedThread.context?.messages
  );
});

test("requires confirmation before retrying an unknown compaction operation", async () => {
  const { createThreadStore } = await import(
    "@/components/thread-playground/stores"
  );
  const persisted = await _threadWithUnknownCompaction();
  let transportCalls = 0;
  const transport: AgentTransport = async function* transport() {
    transportCalls += 1;
    yield* [] as AgentEvent[];
  };
  const store = createThreadStore(persisted, {
    transport,
    resolveModel: saved => saved ?? null,
    runtimeOwnsToolLoop: true
  });

  expect(await store.getState().compactNow()).toBe("confirmationRequired");
  expect(transportCalls).toBe(0);
  expect(await store.getState().compactNow(true)).toBe("finished");
  expect(transportCalls).toBe(1);

  const session = store.getState().thread.runtimeSession as StoredRuntimeSession;
  expect(session.snapshot.runs).toHaveLength(3);
  expect(session.snapshot.runs[1]).toMatchObject({
    state: "outcomeUnknown",
    branchId: "branch-1"
  });
  expect(session.snapshot.runs[2]).toMatchObject({
    state: "completed",
    branchId: "branch-1",
    baseCheckpointId: session.snapshot.history.currentCheckpointId
  });
});

test("rolls back an in-memory branch rename when Thread persistence fails", async () => {
  const { createThreadStore } = await import(
    "@/components/thread-playground/stores"
  );
  const persisted = await _settledRuntimeThread();
  const original = persisted.runtimeSession as StoredRuntimeSession;
  const store = createThreadStore(persisted, {
    transport: async function* transport() {
      yield* [] as AgentEvent[];
    },
    resolveModel: saved => saved ?? null,
    persistSettledThread: async () => {
      throw new Error("disk unavailable");
    }
  });

  expect(await store.getState().renameRuntimeBranch(
    "branch-1",
    "Renamed"
  )).toBe(false);
  const after = store.getState().thread.runtimeSession as StoredRuntimeSession;
  expect(after.version).toBe(original.version);
  expect(after.snapshot.history.branches[0]?.label).toBe("Main");
});

test("uses Local Server rename authority and applies its projection", async () => {
  const { createThreadStore } = await import(
    "@/components/thread-playground/stores"
  );
  const initialSession = await _terminalServerSession();
  let authorityCalls = 0;
  let persisted: Thread | null = null;
  const store = createThreadStore({
    model: { provider: "fake", id: "fake-model" },
    context: { messages: [], tools: [] },
    runtimeProfile: {
      version: 1,
      type: "localServer",
      artifactFingerprint: "a".repeat(64),
      serverSessionId: "session-one"
    },
    runtimeSession: initialSession
  }, {
    async* transport() {},
    renameRuntimeBranchAuthority: async (branchId, label) => {
      authorityCalls += 1;
      const memory = new InMemorySessionStore([initialSession]);
      return memory.commit({
        sessionId: "session-one",
        expectedVersion: initialSession.version,
        mutations: [{ type: "renameBranch", branchId, label }]
      });
    },
    persistSettledThread: async thread => { persisted = thread; }
  });

  expect(await store.getState().renameRuntimeBranch(
    "branch-1",
    "Investigation"
  )).toBe(true);
  expect(authorityCalls).toBe(1);
  expect(((persisted as Thread | null)?.runtimeSession as StoredRuntimeSession)
    .snapshot.history.branches[0]?.label).toBe("Investigation");
  expect((store.getState().thread.runtimeSession as StoredRuntimeSession)
    .snapshot.history.branches[0]?.label).toBe("Investigation");
});

test("adopts the Local Server terminal Session and checkpoint", async () => {
  const { createThreadStore } = await import(
    "@/components/thread-playground/stores"
  );
  const terminalSession = await _terminalServerSession();
  let persisted: Thread | null = null;
  const store = createThreadStore({
    model: { provider: "fake", id: "fake-model" },
    context: {
      messages: [{
        id: "message-one",
        role: "user",
        content: [{ type: "text", text: "hello" }]
      }],
      tools: []
    },
    runtimeProfile: {
      version: 1,
      type: "localServer",
      artifactFingerprint: "a".repeat(64),
      serverSessionId: "session-one"
    }
  }, {
    async* transport() {},
    transportOwnsRuntimeRun: true,
    resolveModel: saved => saved ?? null,
    resolveCommittedRuntimeSession: () => terminalSession,
    resolveTransportRuntimeCheckpoint: () => ({
      runId: "run-one",
      branchId: "branch-1",
      checkpointId: "run-one:checkpoint:1",
      state: "completed",
      checkpointOrder: 1,
      profile: "localServer",
      continuationFingerprint: "server-terminal",
      server: {
        profile: "localServer",
        artifactFingerprint: "a".repeat(64),
        sessionId: "session-one",
        runId: "run-one"
      }
    }),
    persistSettledThread: async thread => { persisted = thread; }
  });

  await store.getState().run();

  expect(store.getState().thread.runtimeSession).toEqual(terminalSession);
  expect(store.getState().thread.runtimeWorkingBase).toEqual({
    sessionId: "session-one",
    branchId: "branch-1",
    checkpointId: "run-one:checkpoint:1"
  });
  expect(store.getState().runHistory.at(-1)?.runtime).toMatchObject({
    runId: "run-one",
    branchId: "branch-1",
    checkpointId: "run-one:checkpoint:1"
  });
  expect((persisted as Thread | null)?.runtimeSession).toEqual(terminalSession);
  expect((persisted as Thread | null)?.runtimeWorkingBase).toEqual({
    sessionId: "session-one",
    branchId: "branch-1",
    checkpointId: "run-one:checkpoint:1"
  });
});

async function _threadWithUnknownCompaction(): Promise<Thread> {
  const thread = await _settledRuntimeThread();
  const settled = thread.runtimeSession as StoredRuntimeSession;
  const base = thread.runtimeWorkingBase!;
  const baseCheckpoint = settled.snapshot.history.checkpoints.find(
    checkpoint => checkpoint.id === base.checkpointId
  );
  if (!baseCheckpoint) { throw new Error("Expected Runtime working base"); }
  const store = new InMemorySessionStore([settled]);
  const runId = "run-unknown-compaction";
  const started = await store.commit({
    sessionId: settled.snapshot.id,
    expectedVersion: settled.version,
    mutations: [{
      type: "startRun",
      runId,
      configuration: {
        id: "configuration-unknown-compaction",
        agentSnapshotFingerprint: "standalone-thread",
        contextFingerprint: "unknown-compaction-context",
        executionMode: "react",
        model: { provider: "fake", id: "model" },
        toolConfigurationFingerprint: "unknown-compaction-tools"
      },
      messages: runtimeHistoryMessages(
        settled.snapshot.history,
        baseCheckpoint.headEntryId
      ),
      workingBase: {
        branchId: base.branchId,
        checkpointId: base.checkpointId
      }
    }]
  });
  const stepId = `${runId}:step:1`;
  const operationId = `${stepId}:provider:fake:compaction-1`;
  const preCall = await store.commit({
    sessionId: settled.snapshot.id,
    expectedVersion: started.version,
    mutations: [{
      type: "startOperation",
      runId,
      stepId,
      stepSequence: 1,
      transcriptMessageCount: 2,
      operationId,
      kind: "provider",
      provider: "fake",
      requestFingerprint: "a".repeat(64)
    }]
  });
  const unknown = await store.commit({
    sessionId: settled.snapshot.id,
    expectedVersion: preCall.version,
    mutations: [
      {
        type: "settleOperation",
        runId,
        operationId,
        requestFingerprint: "a".repeat(64),
        state: "outcomeUnknown"
      },
      { type: "transitionRun", runId, to: "outcomeUnknown" }
    ]
  });
  return { ...thread, runtimeSession: unknown };
}

async function _terminalServerSession(): Promise<StoredRuntimeSession> {
  const store = new InMemorySessionStore();
  const messages: RuntimeJsonValue[] = [];
  const started = await store.commit({
    sessionId: "session-one",
    expectedVersion: null,
    mutations: [{
      type: "startRun",
      runId: "run-one",
      messages,
      configuration: {
        id: "configuration-one",
        agentSnapshotFingerprint: "a".repeat(64),
        contextFingerprint: "b".repeat(64),
        executionMode: "react",
        model: { provider: "fake", id: "fake-model" },
        toolConfigurationFingerprint: "c".repeat(64)
      }
    }]
  });
  return store.commit({
    sessionId: "session-one",
    expectedVersion: started.version,
    mutations: [
      { type: "transitionRun", runId: "run-one", to: "completed" },
      {
        type: "recordCheckpoint",
        runId: "run-one",
        messages,
        continuationFingerprint: "server-terminal"
      }
    ]
  });
}

async function _settledRuntimeThread(): Promise<Thread> {
  const initial = _initialRuntimeThread();
  const runtime = new ThreadRuntimeSession(undefined);
  const begun = await runtime.begin({
    thread: initial,
    context: initial.context ?? {},
    executionMode: "react",
    model: initial.model!
  });
  const completedThread: Thread = {
    ...initial,
    context: {
      ...initial.context,
      messages: [
        ...(initial.context?.messages ?? []),
        {
          id: "assistant-settled",
          role: "assistant",
          content: [{ type: "text", text: "Done" }]
        }
      ]
    }
  };
  const settled = await runtime.settle({
    thread: completedThread,
    context: completedThread.context ?? {},
    executionMode: "react",
    model: completedThread.model!,
    runId: begun.runId,
    sawEvent: true,
    outcome: "completed"
  });
  if (!settled.checkpoint?.branchId || !settled.checkpoint.checkpointId) {
    throw new Error("Expected a settled Runtime checkpoint");
  }
  return {
    ...completedThread,
    runtimeSession: settled.session,
    runtimeWorkingBase: {
      sessionId: settled.session.snapshot.id,
      branchId: settled.checkpoint.branchId,
      checkpointId: settled.checkpoint.checkpointId
    }
  };
}

function _initialRuntimeThread(): Thread {
  return {
    model: { provider: "fake", id: "model" },
    context: {
      tools: [{
        type: "function",
        name: "weather",
        description: "Get weather",
        parameters: { type: "object", properties: {} }
      }],
      messages: [{
        id: "user-one",
        role: "user",
        content: [{ type: "text", text: "Weather?" }]
      }]
    }
  };
}
