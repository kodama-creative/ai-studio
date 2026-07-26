import {
  type Api,
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
  test("uses the frozen Run limit before the first forbidden provider dispatch", async () => {
    let providerCalls = 0;
    const context = _context("model-call-limit-session");
    const store = await _startedStore(context, [], 1);
    const session = await new AgentRuntime({
      models: _models(),
      project: _project({ limits: { maxModelCallsPerRun: false } })
    }).createSession({
      capabilityPolicy: _policy(),
      context,
      executionMode: "react",
      sessionStore: store,
      streamFn: (model, piContext) => {
        providerCalls += 1;
        return _manualStream(model, piContext);
      }
    });

    expect(await _rejection(session.prompt("hello"))).toMatchObject({
      name: "RuntimeRunLimitExceededError",
      code: "runLimitExceeded",
      axis: "modelCalls",
      consumed: 1,
      attempted: 2,
      limit: 1
    });
    expect(providerCalls).toBe(1);
    expect((await store.load(context.id))?.snapshot.runs[0]).toMatchObject({
      state: "failed",
      failure: {
        code: "runLimitExceeded",
        axis: "modelCalls",
        consumed: 1,
        attempted: 2,
        limit: 1
      }
    });
  });

  test("uses the frozen Run budget after source rebuild and settles its tool batch", async () => {
    let providerCalls = 0;
    let toolExecutions = 0;
    const context = _context("budget-boundary-session");
    const store = new InMemorySessionStore();
    await store.commit({
      sessionId: context.id,
      expectedVersion: null,
      mutations: [{
        type: "startRun",
        runId: context.turn.id,
        messages: [],
        configuration: {
          id: "configuration-budget-boundary",
          agentSnapshotFingerprint: "snapshot-compaction",
          contextFingerprint: "context-budget",
          executionMode: "react",
          limits: {
            maxInputTokensPerSession: 1,
            maxOutputTokensPerSession: 10
          },
          model: { provider: "fake", id: "fake-model" },
          toolConfigurationFingerprint: "tools-budget"
        }
      }]
    });
    const runtime = new AgentRuntime({
      models: _models(),
      project: _project({
        limits: { maxInputTokensPerSession: 999, maxOutputTokensPerSession: 999 },
        onExecute: () => { toolExecutions += 1; }
      })
    });
    const session = await runtime.createSession({
      capabilityPolicy: _policy(),
      context,
      executionMode: "react",
      sessionStore: store,
      streamFn: (model, streamContext) => {
        providerCalls += 1;
        return _manualStream(model, streamContext);
      }
    });

    await session.prompt("hello");

    const persisted = await store.load(context.id);
    expect(providerCalls).toBe(1);
    expect(toolExecutions).toBe(1);
    expect(session.messages.map(message => message.role)).toEqual([
      "user",
      "assistant",
      "toolResult"
    ]);
    expect(persisted?.snapshot.runs.at(-1)?.state).toBe("waitingForBudget");
    expect(persisted?.snapshot.budget).toMatchObject({
      inputTokens: 1,
      outputTokens: 1,
      waits: [{ reached: ["input"], status: "waiting" }]
    });
  });

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
  messages: AgentMessage[],
  maxModelCallsPerRun?: number
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
        ...(maxModelCallsPerRun === undefined
          ? {}
          : { limits: { maxModelCallsPerRun } }),
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
    toolContributions: ["tool:echo"]
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

function _project(options: {
  limits?: {
    readonly maxInputTokensPerSession?: false | number;
    readonly maxModelCallsPerRun?: false | number;
    readonly maxOutputTokensPerSession?: false | number;
  };
  onExecute?: () => void;
} = {}): AgentProjectSnapshot {
  return {
    root: "/agent",
    definition: {
      model: { provider: "fake", id: "fake-model" },
      ...(options.limits ? { limits: options.limits } : {})
    },
    instructions: "Test agent.",
    tools: [{
      name: "echo",
      label: "Echo",
      description: "Echo input.",
      parameters: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
        additionalProperties: false
      },
      async execute() {
        options.onExecute?.();
        return {
          content: [{ type: "text", text: "echoed" }],
          details: undefined
        };
      }
    }],
    connections: [],
    resources: { skills: [] },
    diagnostics: [],
    fingerprint: "snapshot-compaction"
  };
}

function _manualStream(
  _model: Model<Api>,
  context: Context
) {
  const hasToolResult = context.messages.at(-1)?.role === "toolResult";
  return _completedStream(
    hasToolResult
      ? _assistant([{ type: "text", text: "done" }], "stop")
      : _assistant([{
        type: "toolCall",
        id: "call-one",
        name: "echo",
        arguments: { text: "hello" }
      }], "toolUse")
  );
}

function _completedStream(message: AssistantMessage) {
  const stream = createAssistantMessageEventStream();
  queueMicrotask(() => {
    stream.push({ type: "start", partial: message });
    stream.push({ type: "done", reason: message.stopReason, message });
  });
  return stream;
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

async function _rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("Expected operation to reject");
}
