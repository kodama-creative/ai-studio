import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  type Api,
  type AssistantMessage,
  type Context,
  createAssistantMessageEventStream,
  createModels,
  createProvider,
  type Message,
  type Model
} from "@earendil-works/pi-ai";
import { LocalFileSystem } from "@llm-space/core/server";
import {
  InMemorySessionStore,
  parkRuntimeRunForBudget,
  type RuntimeJsonValue,
  type StoredRuntimeSession
} from "@llm-space/runtime/harness";
import {
  AGENT_BUNDLE_COMPILER_SUPPORT_FILENAME,
  generateAgentBundleCompilerSupport
} from "@llm-space/runtime/node";
import { afterEach, expect, test } from "bun:test";

import type { AgentMessage } from "@earendil-works/pi-agent-core";

import { ExternalAgentProjectManager } from "../../../src/bun/external-projects/external-agent-project-manager";
import { StreamThreadController } from "../../../src/bun/streaming/stream-thread";

const ROOTS: string[] = [];
const MANAGERS: ExternalAgentProjectManager[] = [];

afterEach(async () => {
  await Promise.all(
    MANAGERS.splice(0).map(async manager => manager.shutdown())
  );
  await Promise.all(
    ROOTS.splice(0).map(async root => rm(root, { recursive: true }))
  );
});

test("runs explicit compaction without dispatching a main model turn", async () => {
  const root = await mkdtemp(path.join(
    tmpdir(),
    "llm-space-standalone-compaction-"
  ));
  ROOTS.push(root);
  const localFs = new LocalFileSystem(root);
  const threadPath = "compact.json";
  const threadMessages = Array.from({ length: 32 }, (_, index) => ({
    id: `message-${index}`,
    role: "user" as const,
    content: [{
      type: "text" as const,
      text: `${index}: ${"context ".repeat(500)}`
    }]
  }));
  const piMessages: Message[] = threadMessages.map((message, index) => ({
    role: "user",
    content: message.content,
    timestamp: index
  }));
  const runtimeSession = await _startedDesktopRun(piMessages);
  await localFs.write(threadPath, {
    model: { provider: "fake", id: "fake-model" },
    context: { messages: threadMessages, tools: [] },
    runtimeSession
  });
  let providerDispatches = 0;
  const controller = new StreamThreadController(
    _modelManager(_models(() => { providerDispatches += 1; })),
    { capture: () => undefined } as never,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    localFs
  );
  const responses: Array<{ readonly type: string; }> = [];

  await controller.run({
    streamId: "standalone-compact",
    runtime: { type: "desktopThread", executionMode: "react", threadPath },
    request: {
      action: "compact",
      model: { provider: "fake", id: "fake-model" },
      context: { messages: piMessages, tools: [], sourceTools: [] }
    }
  }, message => { responses.push(message); });

  expect(providerDispatches).toBe(1);
  expect(responses.some(message => message.type === "event")).toBe(false);
  expect(responses.filter(message => message.type === "runtimePhase"))
    .toHaveLength(2);
  expect(responses.at(-1)?.type).toBe("done");
  const persisted = await localFs.read(threadPath);
  expect((persisted.runtimeSession as StoredRuntimeSession)
    .snapshot.history.compactions).toEqual([
    expect.objectContaining({ runId: "run-react" })
  ]);
});

test("forwards the Local Server base and publishes its terminal Session", async () => {
  const session = await _terminalServerSession();
  let observedBase: unknown;
  const localServers = {
    run: async (input: { workingBase?: unknown; }, callbacks: {
      onLineage(lineage: unknown): void;
      onStatus(status: unknown): void;
      onTerminal(
        lineage: unknown,
        outcome: "completed",
        code: undefined,
        runtime: unknown
      ): void;
    }) => {
      observedBase = input.workingBase;
      const lineage = {
        profile: "localServer" as const,
        artifactFingerprint: "a".repeat(64),
        sessionId: "session-one",
        runId: "run-one"
      };
      callbacks.onLineage(lineage);
      callbacks.onStatus({ state: "running" });
      callbacks.onTerminal(lineage, "completed", undefined, {
        branchId: "branch-1",
        checkpointId: "run-one:checkpoint:1",
        session
      });
    }
  };
  const controller = new StreamThreadController(
    {
      isBuiltin: () => false,
      isBuiltinCatalogModel: () => false
    } as never,
    { capture: () => undefined } as never,
    undefined,
    undefined,
    undefined,
    localServers as never
  );
  const responses: Array<{ type: string; }> = [];

  await controller.run({
    streamId: "local-server-authority",
    runtime: {
      type: "localServerAgentProject",
      projectId: "project-one",
      threadId: "thread-one",
      workingBase: {
        branchId: "branch-1",
        checkpointId: "run-base:checkpoint:1"
      }
    },
    request: {
      model: { provider: "server", id: "server" },
      context: {
        messages: [{
          role: "user",
          content: [{ type: "text", text: "fork here" }],
          timestamp: 0
        }],
        tools: [],
        sourceTools: []
      }
    }
  }, message => { responses.push(message); });

  expect(observedBase).toEqual({
    branchId: "branch-1",
    checkpointId: "run-base:checkpoint:1"
  });
  expect(responses.map(response => response.type)).toEqual([
    "localServerLineage",
    "localServerStatus",
    "runtimeSession",
    "localServerLineage",
    "done"
  ]);
  expect(responses[2]).toMatchObject({
    type: "runtimeSession",
    runtimeSession: {
      snapshot: { history: { currentCheckpointId: "run-one:checkpoint:1" } }
    }
  });
});

test("decides a registered Session budget using only wait identity and decision", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "llm-space-budget-rpc-"));
  ROOTS.push(root);
  const localFs = new LocalFileSystem(root);
  const threadPath = "budget.json";
  const runId = "run-budget";
  const store = new InMemorySessionStore();
  const started = await store.commit({
    sessionId: "session-budget",
    expectedVersion: null,
    mutations: [{
      type: "startRun",
      runId,
      messages: [],
      configuration: {
        id: "configuration-budget",
        agentSnapshotFingerprint: "desktop-thread-runtime-v1",
        contextFingerprint: "desktop-budget-context",
        executionMode: "react",
        limits: { maxInputTokensPerSession: 1 },
        model: { provider: "fake", id: "fake-model" },
        toolConfigurationFingerprint: "desktop-budget-tools"
      }
    }]
  });
  const settled = await store.commit({
    sessionId: "session-budget",
    expectedVersion: started.version,
    mutations: [
      {
        type: "startOperation",
        runId,
        stepId: `${runId}:step:1`,
        stepSequence: 1,
        transcriptMessageCount: 1,
        operationId: `${runId}:step:1:provider:fake`,
        kind: "provider",
        provider: "fake",
        requestFingerprint: "a".repeat(64)
      },
      {
        type: "settleOperation",
        runId,
        operationId: `${runId}:step:1:provider:fake`,
        requestFingerprint: "a".repeat(64),
        state: "completed",
        replay: {
          byteLength: 2,
          resultFingerprint:
            "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a",
          value: {}
        },
        mainProviderUsage: { input: 1, output: 0, metered: true }
      }
    ]
  });
  const waiting = await parkRuntimeRunForBudget(store, {
    sessionId: "session-budget",
    runId,
    expectedVersion: settled.version
  });
  const waitId = waiting.snapshot.budget?.waits.at(-1)?.id;
  if (!waitId) { throw new Error("Expected Session budget wait"); }
  const thread = { runtimeSession: waiting };
  await localFs.write(threadPath, thread);
  const controller = new StreamThreadController(
    _modelManager(createModels()),
    { capture: () => undefined } as never,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    localFs
  );
  controller.registerDesktopThreadApprovals(threadPath, thread);

  expect(controller.decideSessionBudget({
    budgetWaitId: "unknown-wait",
    decision: "freshWindow"
  })).rejects.toThrow("is not registered");
  const granted = await controller.decideSessionBudget({
    budgetWaitId: waitId,
    decision: "freshWindow"
  });

  expect(granted.snapshot.runs.at(-1)).toMatchObject({
    id: runId,
    state: "runningModel"
  });
  expect(granted.snapshot.budget?.waits.at(-1)).toMatchObject({
    id: waitId,
    status: "granted"
  });
  const persisted = await localFs.read(threadPath);
  expect((persisted.runtimeSession as StoredRuntimeSession)
    .snapshot.budget?.waits.at(-1)?.status).toBe("granted");
});

test("selects a frozen Agent snapshot after source sync and Desktop restart", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "llm-space-frozen-agent-"));
  ROOTS.push(root);
  const home = path.join(root, "home");
  const workspace = path.join(home, "workspace");
  const project = path.join(root, "project");
  const agentRoot = path.join(project, "agent");
  const compilerSupportRoot = path.join(root, "compiler-support");
  await generateAgentBundleCompilerSupport(compilerSupportRoot);
  const compilerSupportPath = path.join(
    compilerSupportRoot,
    AGENT_BUNDLE_COMPILER_SUPPORT_FILENAME
  );
  await mkdir(agentRoot, { recursive: true });
  await mkdir(workspace, { recursive: true });
  await writeFile(
    path.join(project, "llm-space.json"),
    JSON.stringify({ schemaVersion: 1, agent: "./agent" })
  );
  await _writeBudgetAgent(agentRoot, 1);
  const models = _models(() => {});
  const first = new ExternalAgentProjectManager({
    compilerSupportPath,
    getModels: async () => Promise.resolve(models),
    homePath: home,
    workspaceRoot: workspace
  });
  MANAGERS.push(first);
  const opened = await first.trustAndOpen(project);
  const threadId = opened.threads[0]!.id;
  const snapshotA = opened.snapshot;
  const waiting = await _waitingProjectRun(snapshotA);
  const original = await first.readThread(opened.id, threadId);
  await first.writeThread(opened.id, threadId, {
    ...original,
    thread: { ...original.thread, runtimeSession: waiting }
  });

  await _writeBudgetAgent(agentRoot, 99);
  const rebuilt = await first.refresh(opened.id);
  const snapshotB = rebuilt.snapshot;
  expect(snapshotB).not.toBe(snapshotA);
  const synced = await first.syncThreadFromAgent(opened.id, threadId);
  expect(synced.thread.agentRuntime?.snapshot).toBe(snapshotB);
  expect((synced.thread.runtimeSession as StoredRuntimeSession)
    .configurations[0]?.agentSnapshotFingerprint).toBe(snapshotA);
  await first.shutdown();

  const restarted = new ExternalAgentProjectManager({
    compilerSupportPath,
    getModels: async () => Promise.resolve(models),
    homePath: home,
    workspaceRoot: workspace
  });
  MANAGERS.push(restarted);
  try {
    await restarted.list();
    const reopened = await restarted.readThread(opened.id, threadId);
    const waitId = (reopened.thread.runtimeSession as StoredRuntimeSession)
      .snapshot.budget?.waits.at(-1)?.id;
    if (!waitId) { throw new Error("Expected frozen Agent budget wait"); }
    const controller = new StreamThreadController(
      _modelManager(models),
      { capture: () => undefined } as never,
      restarted
    );
    controller.registerAgentProjectThreadApprovals(
      opened.id,
      threadId,
      reopened.thread
    );
    await controller.decideSessionBudget({
      budgetWaitId: waitId,
      decision: "freshWindow"
    });
    const resumedResponses: Array<Record<string, unknown>> = [];
    await controller.run(
      _projectRequest(opened.id, threadId, "resume-a"),
      message => { resumedResponses.push(message); }
    );
    expect(resumedResponses.find(message => message.type === "runtime"))
      .toMatchObject({ runtime: { snapshot: snapshotA } });

    const afterResume = await restarted.readThread(opened.id, threadId);
    const resumedSession = afterResume.thread.runtimeSession as
      StoredRuntimeSession;
    const activeRunId = resumedSession.snapshot.activeRunId;
    if (!activeRunId) { throw new Error("Expected active frozen Agent Run"); }
    const store = new InMemorySessionStore([resumedSession]);
    const next = await store.commit({
      sessionId: resumedSession.snapshot.id,
      expectedVersion: resumedSession.version,
      mutations: [
        { type: "transitionRun", runId: activeRunId, to: "superseded" },
        {
          type: "startRun",
          runId: "run-agent-b",
          messages: [],
          configuration: {
            id: "configuration-agent-b",
            agentSnapshotFingerprint: snapshotB,
            contextFingerprint: "context-agent-b",
            executionMode: "react",
            limits: { maxInputTokensPerSession: 99 },
            model: { provider: "fake", id: "fake-model" },
            toolConfigurationFingerprint: "tools-agent-b"
          }
        }
      ]
    });
    await restarted.writeThread(opened.id, threadId, {
      ...afterResume,
      thread: { ...afterResume.thread, runtimeSession: next }
    });
    const newRunResponses: Array<Record<string, unknown>> = [];
    await controller.run(
      _projectRequest(opened.id, threadId, "run-b"),
      message => { newRunResponses.push(message); }
    );
    expect(newRunResponses.find(message => message.type === "runtime"))
      .toMatchObject({ runtime: { snapshot: snapshotB } });
  } finally {
    await restarted.shutdown();
  }
});

async function _writeBudgetAgent(agentRoot: string, inputLimit: number) {
  await writeFile(
    path.join(agentRoot, "agent.ts"),
    `import { defineAgent } from "@llm-space/runtime";
    export default defineAgent({
      model: "fake/fake-model",
      limits: { maxInputTokensPerSession: ${inputLimit} }
    });`
  );
  await writeFile(
    path.join(agentRoot, "instructions.md"),
    `Agent input limit is ${inputLimit}.\n`
  );
}

async function _waitingProjectRun(
  agentSnapshotFingerprint: string
): Promise<StoredRuntimeSession> {
  const store = new InMemorySessionStore();
  const started = await store.commit({
    sessionId: "session-frozen-agent",
    expectedVersion: null,
    mutations: [{
      type: "startRun",
      runId: "run-agent-a",
      messages: [_projectUserMessage()] as unknown as RuntimeJsonValue[],
      configuration: {
        id: "configuration-agent-a",
        agentSnapshotFingerprint,
        contextFingerprint: "context-agent-a",
        executionMode: "react",
        limits: { maxInputTokensPerSession: 1 },
        model: { provider: "fake", id: "fake-model" },
        toolConfigurationFingerprint: "tools-agent-a"
      }
    }]
  });
  const settled = await store.commit({
    sessionId: "session-frozen-agent",
    expectedVersion: started.version,
    mutations: [
      {
        type: "startOperation",
        runId: "run-agent-a",
        stepId: "run-agent-a:step:1",
        stepSequence: 1,
        transcriptMessageCount: 1,
        operationId: "run-agent-a:step:1:provider:fake",
        kind: "provider",
        provider: "fake",
        requestFingerprint: "a".repeat(64)
      },
      {
        type: "settleOperation",
        runId: "run-agent-a",
        operationId: "run-agent-a:step:1:provider:fake",
        requestFingerprint: "a".repeat(64),
        state: "completed",
        replay: {
          byteLength: 2,
          resultFingerprint:
            "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a",
          value: {}
        },
        mainProviderUsage: { input: 1, output: 0, metered: true }
      }
    ]
  });
  return parkRuntimeRunForBudget(store, {
    sessionId: "session-frozen-agent",
    runId: "run-agent-a",
    expectedVersion: settled.version
  });
}

function _projectRequest(projectId: string, threadId: string, streamId: string) {
  return {
    streamId,
    runtime: {
      type: "agentProject" as const,
      executionMode: "react" as const,
      modelSource: "agent" as const,
      projectId,
      sandboxAttachmentMessageIds: [],
      threadId
    },
    request: {
      model: { provider: "fake", id: "fake-model" },
      context: {
        messages: [_projectUserMessage()],
        tools: [],
        sourceTools: []
      }
    }
  };
}

function _projectUserMessage(): Message {
  return {
    role: "user",
    content: [{ type: "text", text: "continue" }],
    timestamp: 0
  };
}

async function _startedDesktopRun(
  messages: AgentMessage[]
): Promise<StoredRuntimeSession> {
  const store = new InMemorySessionStore();
  return store.commit({
    sessionId: "session-react",
    expectedVersion: null,
    mutations: [{
      type: "startRun",
      runId: "run-react",
      messages: messages as unknown as RuntimeJsonValue[],
      configuration: {
        id: "configuration-react",
        agentSnapshotFingerprint: "desktop-thread-runtime-v1",
        contextFingerprint: "desktop-test-context",
        executionMode: "react",
        model: { provider: "fake", id: "fake-model" },
        toolConfigurationFingerprint: "desktop-test-tools"
      }
    }]
  });
}

async function _terminalServerSession(): Promise<StoredRuntimeSession> {
  const store = new InMemorySessionStore();
  const messages = [{
    role: "user",
    content: [{ type: "text", text: "hello" }],
    timestamp: 0
  }] as unknown as RuntimeJsonValue[];
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

function _modelManager(models: ReturnType<typeof _models>) {
  return {
    getAvailableModels: async () => Promise.resolve(models),
    getBaseUrl: () => undefined,
    getHeaders: () => undefined,
    isBuiltin: () => false,
    isBuiltinCatalogModel: () => false
  } as never;
}

function _models(onStream: () => void) {
  const model: Model<"fake"> = {
    id: "fake-model",
    name: "Fake Model",
    api: "fake",
    provider: "fake",
    baseUrl: "http://localhost.invalid",
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 4_096
  };
  const api = {
    stream: (_model: Model<Api>, context: Context) => {
      onStream();
      return _stream(context);
    },
    streamSimple: (_model: Model<Api>, context: Context) => {
      onStream();
      return _stream(context);
    }
  };
  const provider = createProvider({
    id: "fake",
    auth: {
      apiKey: {
        name: "Fake",
        resolve: async () => Promise.resolve({ auth: {} })
      }
    },
    models: [model],
    api
  });
  const models = createModels();
  models.setProvider(provider);
  return models;
}

function _stream(context: Context) {
  const stream = createAssistantMessageEventStream();
  const message: AssistantMessage = {
    role: "assistant",
    content: [{ type: "text", text: "done" }],
    api: "fake",
    provider: "fake",
    model: "fake-model",
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
    },
    stopReason: "stop",
    timestamp: Date.now()
  };
  void context;
  queueMicrotask(() => {
    stream.push({ type: "start", partial: message });
    stream.push({ type: "done", reason: "stop", message });
  });
  return stream;
}
