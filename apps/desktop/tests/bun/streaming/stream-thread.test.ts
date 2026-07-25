import { mkdtemp, rm } from "node:fs/promises";
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
  type RuntimeJsonValue,
  type StoredRuntimeSession
} from "@llm-space/runtime/harness";
import { afterEach, expect, test } from "bun:test";

import type { AgentMessage } from "@earendil-works/pi-agent-core";

import { StreamThreadController } from "../../../src/bun/streaming/stream-thread";

const ROOTS: string[] = [];

afterEach(async () => {
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
