import {
  type AssistantMessage,
  type Context,
  createAssistantMessageEventStream,
  type Model,
  type Models
} from "@earendil-works/pi-ai";
import { describe, expect, test } from "bun:test";

import type { AgentMessage } from "@earendil-works/pi-agent-core";

import { AgentRuntime } from "../../../src/runtime/agent/agent-runtime";
import { InMemorySessionStore } from "../../../src/runtime/harness/in-memory-session-store";

import type { AgentProjectSnapshot } from "../../../src/runtime/agent/agent-project-snapshot";
import type { RuntimeJsonValue } from "../../../src/runtime/harness/runtime-run";

describe("AgentSession context compaction", () => {
  test("explicit compaction never dispatches the main provider", async () => {
    const context = _context("explicit-compaction-session");
    const messages = _longMessages();
    const store = await _startedStore(context, messages);
    let summaryDispatches = 0;
    let mainDispatches = 0;
    const models = Object.assign(_models(), {
      completeSimple: async () => {
        summaryDispatches += 1;
        return _assistant(
          [{ type: "text", text: "Explicit compacted context" }],
          "stop"
        );
      }
    }) as Models;
    const session = await new AgentRuntime({
      models,
      project: _project()
    }).createSession({
      capabilityPolicy: _policy(),
      context,
      initialMessages: messages,
      sessionStore: store,
      streamFn: () => {
        mainDispatches += 1;
        return _stoppedStream();
      }
    });

    expect(await session.compactContext()).toBe(true);
    expect(summaryDispatches).toBe(1);
    expect(mainDispatches).toBe(0);
    expect((await store.load(context.id))?.snapshot.history.compactions)
      .toEqual([
        expect.objectContaining({
          runId: context.turn.id,
          summary: "Explicit compacted context"
        })
      ]);
  });

  test("projects a durable summary and recent messages to the main provider", async () => {
    const context = _context("automatic-compaction-session");
    const messages = _longMessages();
    const store = await _startedStore(context, messages);
    const model = { ..._fakeModel(), contextWindow: 32_000 };
    const models = {
      getModel: (provider: string, id: string) =>
        (provider === model.provider && id === model.id ? model : undefined),
      completeSimple: async () => _assistant(
        [{ type: "text", text: "Durable automatic summary" }],
        "stop"
      )
    } as unknown as Models;
    let providerContext: Context | null = null;
    const session = await new AgentRuntime({
      models,
      project: _project()
    }).createSession({
      capabilityPolicy: _policy(),
      context,
      initialMessages: messages,
      sessionStore: store,
      streamFn: (_model, mainContext) => {
        providerContext = mainContext;
        return _stoppedStream();
      }
    });

    await session.continue();

    expect(providerContext).not.toBeNull();
    const captured = providerContext as unknown as Context;
    expect(JSON.stringify(captured)).toContain("Durable automatic summary");
    expect(captured.messages[0]).toMatchObject({ role: "user" });
    expect(captured.messages.length).toBeLessThan(messages.length);
    expect((await store.load(context.id))?.snapshot.history.compactions)
      .toHaveLength(1);
  });

  test("does not dispatch the main provider after a known summary failure", async () => {
    const context = _context("failed-compaction-session");
    const messages = _longMessages();
    const store = await _startedStore(context, messages);
    let mainDispatches = 0;
    const model = { ..._fakeModel(), contextWindow: 32_000 };
    const models = {
      getModel: (provider: string, id: string) =>
        (provider === model.provider && id === model.id ? model : undefined),
      completeSimple: async () => _assistant([], "error")
    } as unknown as Models;
    const session = await new AgentRuntime({
      models,
      project: _project()
    }).createSession({
      capabilityPolicy: _policy(),
      context,
      initialMessages: messages,
      sessionStore: store,
      streamFn: () => {
        mainDispatches += 1;
        return _stoppedStream();
      }
    });

    try {
      await session.continue();
    } catch {}

    expect(mainDispatches).toBe(0);
    expect((await store.load(context.id))?.snapshot.history.compactions)
      .toEqual([]);
  });
});

async function _startedStore(
  context: ReturnType<typeof _context>,
  messages: AgentMessage[]
): Promise<InMemorySessionStore> {
  const store = new InMemorySessionStore();
  await store.commit({
    sessionId: context.id,
    expectedVersion: null,
    mutations: [{
      type: "startRun",
      runId: context.turn.id,
      messages: messages as unknown as RuntimeJsonValue[],
      configuration: {
        id: `configuration-${context.id}`,
        agentSnapshotFingerprint: "snapshot-compaction",
        contextFingerprint: "context-compaction",
        executionMode: "react",
        model: { provider: "fake", id: "fake-model" },
        toolConfigurationFingerprint: "tools-compaction"
      }
    }]
  });
  return store;
}

function _longMessages(): AgentMessage[] {
  return Array.from({ length: 32 }, (_, index) => ({
    role: "user" as const,
    content: [{
      type: "text" as const,
      text: `${index}: ${"context ".repeat(500)}`
    }],
    timestamp: index
  }));
}

function _policy() {
  return {
    connectionContributions: [],
    modelOptions: {},
    models: [{ provider: "fake", id: "fake-model" }],
    reasoning: ["off", "minimal", "low", "medium", "high", "xhigh"] as const,
    toolContributions: []
  };
}

function _context(id: string) {
  const principal = {
    issuer: "test",
    principalId: "session-test",
    principalType: "runtime" as const
  };
  return {
    id,
    auth: { initiator: principal, current: principal },
    channel: { kind: "test" },
    turn: { id: `turn-${id}`, sequence: 1 }
  };
}

function _models(): Models {
  return {
    getModel(provider: string, id: string) {
      return provider === "fake" && id === "fake-model"
        ? _fakeModel()
        : undefined;
    }
  } as unknown as Models;
}

function _fakeModel(): Model<"fake"> {
  return {
    id: "fake-model",
    name: "Fake Model",
    api: "fake",
    provider: "fake",
    baseUrl: "http://localhost.invalid",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 4_096
  };
}

function _project(): AgentProjectSnapshot {
  return {
    root: "/agent",
    definition: { model: { provider: "fake", id: "fake-model" } },
    instructions: "Test agent.",
    tools: [],
    connections: [],
    resources: { skills: [] },
    diagnostics: [],
    fingerprint: "snapshot-compaction"
  };
}

function _stoppedStream() {
  const message = _assistant([{ type: "text", text: "done" }], "stop");
  const stream = createAssistantMessageEventStream();
  queueMicrotask(() => {
    stream.push({ type: "start", partial: message });
    stream.push({ type: "done", reason: "stop", message });
  });
  return stream;
}

function _assistant(
  content: AssistantMessage["content"],
  stopReason: AssistantMessage["stopReason"]
): AssistantMessage {
  return {
    role: "assistant",
    content,
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
    stopReason,
    ...(stopReason === "error" ? { errorMessage: "summary unavailable" } : {}),
    timestamp: Date.now()
  };
}
