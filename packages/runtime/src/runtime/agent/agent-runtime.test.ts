import {
  type Api,
  type AssistantMessage,
  type Context,
  createAssistantMessageEventStream,
  createModels,
  createProvider,
  type Model,
  type Models
} from "@earendil-works/pi-ai";
import { describe, expect, test } from "bun:test";
import { Type } from "typebox";

import type { AgentMessage, AgentTool } from "@earendil-works/pi-agent-core";

import { AgentRuntime } from "./agent-runtime";
import { defineState } from "../../public/definitions/state";
import { InMemorySessionStore } from "../harness/in-memory-session-store";

import type { AgentProjectSnapshot } from "./agent-project-snapshot";

describe("AgentRuntime", () => {
  test("owns an immutable project and its definition default", () => {
    const project = _project();
    (project.tools as AgentTool[]).push(_tool("original-tool"));

    const runtime = new AgentRuntime({ models: _models(), project });

    expect(runtime.project).not.toBe(project);
    (project.definition!.model as { id: string; }).id = "mutated-model";
    (project.tools[0] as { name: string; }).name = "mutated-tool";
    (project.tools as AgentTool[]).push(_tool("late-tool"));
    expect(runtime.project.definition?.model.id).toBe("fake-model");
    expect(runtime.project.tools.map(tool => tool.name)).toEqual([
      "original-tool"
    ]);
    expect(Object.isFrozen(runtime.project)).toBe(true);
    expect(Object.isFrozen(runtime.project.definition?.model)).toBe(true);
    expect(Object.isFrozen(runtime.project.tools)).toBe(true);
    expect(Object.isFrozen(runtime.project.tools[0])).toBe(true);
    expect(runtime.defaultModel).toEqual({
      selector: { provider: "fake", id: "fake-model" },
      available: true
    });
  });

  test("requires the Host to supply verified Session context", async () => {
    const runtime = new AgentRuntime({ models: _models(), project: _project() });

    expect(await _rejection(runtime.createSession(
      undefined as never
    ))).toMatchObject({
      message: "Agent Runtime Sessions require Host-verified Session context"
    });
  });

  test("runs project tools through Pi Agent using the definition default", async () => {
    let executions = 0;
    const tool: AgentTool = {
      name: "echo",
      label: "Echo",
      description: "Echo input.",
      parameters: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
        additionalProperties: false
      },
      async execute(_toolCallId, input) {
        executions += 1;
        return Promise.resolve({
          content: [
            {
              type: "text",
              text: `echo:${(input as { text: string; }).text}`
            }
          ],
          details: undefined
        });
      }
    };
    const persisted: AgentMessage[][] = [];
    const runtime = new AgentRuntime({
      models: _reactModels(),
      project: { ..._project(), tools: [tool] }
    });

    const session = await runtime.createSession({
      id: "thread-one",
      context: _context("thread-one"),
      executionMode: "react",
      persistence: {
        replaceMessages(messages) {
          persisted.push(messages);
        }
      }
    });
    await session.prompt("hello");

    expect(executions).toBe(1);
    expect(persisted.at(-1)?.map(message => message.role)).toEqual([
      "user",
      "assistant",
      "toolResult",
      "assistant"
    ]);
    expect(session.model).toEqual({ provider: "fake", id: "fake-model" });
  });

  test("commits authored state before Pi starts the next model turn", async () => {
    const store = new InMemorySessionStore();
    let providerCalls = 0;
    const runtime = new AgentRuntime({
      models: _reactModels(),
      project: {
        ..._project(),
        stateDefinitions: [{
          name: RUNTIME_COUNTER.name,
          version: RUNTIME_COUNTER.version,
          schema: RUNTIME_COUNTER.schema,
          schemaFingerprint: "runtime-counter-v1",
          initial: RUNTIME_COUNTER.initial,
          sourcePath: "state/runtime-counter.ts"
        }],
        tools: [{
          ..._tool("echo"),
          async execute() {
            RUNTIME_COUNTER.update(current => ({ count: current.count + 1 }));
            return {
              content: [{ type: "text" as const, text: "updated" }],
              details: {}
            };
          }
        }]
      }
    });
    const session = await runtime.createSession({
      id: "stateful-runtime-session",
      context: _context("stateful-runtime-session"),
      sessionStore: store,
      streamFn: async (_model, context) => {
        providerCalls += 1;
        expect(JSON.stringify(context)).not.toContain(
          "stateful-runtime-session"
        );
        expect(JSON.stringify(context)).not.toContain(RUNTIME_COUNTER.name);
        if (providerCalls === 2) {
          expect((await store.load("stateful-runtime-session"))
            ?.snapshot.state?.values[RUNTIME_COUNTER.name]?.value)
            .toEqual({ count: 1 });
        }
        return _stream(context);
      }
    });
    const events: unknown[] = [];
    session.subscribe(event => { events.push(event); });

    await session.prompt("hello");

    expect(providerCalls).toBe(2);
    expect(JSON.stringify(events)).not.toContain(RUNTIME_COUNTER.name);
    expect(JSON.stringify(events)).not.toContain("stateful-runtime-session");
  });

  test("rolls back automatic state updates while preserving Pi tool-error recovery", async () => {
    const store = new InMemorySessionStore();
    const runtime = new AgentRuntime({
      models: _reactModels(),
      project: {
        ..._project(),
        stateDefinitions: [{
          name: RUNTIME_COUNTER.name,
          version: RUNTIME_COUNTER.version,
          schema: RUNTIME_COUNTER.schema,
          schemaFingerprint: "runtime-counter-v1",
          initial: RUNTIME_COUNTER.initial,
          sourcePath: "state/runtime-counter.ts"
        }],
        tools: [{
          ..._tool("echo"),
          async execute() {
            RUNTIME_COUNTER.update(() => ({ count: 9 }));
            throw new Error("tool failed");
          }
        }]
      }
    });
    const session = await runtime.createSession({
      context: _context("recoverable-tool-error"),
      sessionStore: store
    });

    await session.prompt("hello");

    expect(session.messages.map(message => message.role)).toEqual([
      "user",
      "assistant",
      "toolResult",
      "assistant"
    ]);
    expect(session.messages[2]).toMatchObject({ isError: true });
    expect(await store.load("recoverable-tool-error")).toBeNull();
  });

  test("keeps manual placeholders internal and continues from resolved results", async () => {
    let executions = 0;
    const store = new InMemorySessionStore();
    await store.commit({
      sessionId: "manual-session",
      expectedVersion: null,
      mutations: [{
        type: "replaceState",
        values: {
          [RUNTIME_COUNTER.name]: {
            definitionVersion: 1,
            schemaFingerprint: "stale-schema",
            value: { count: 2 }
          }
        }
      }]
    });
    const tool: AgentTool = {
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
        executions += 1;
        RUNTIME_COUNTER.update(current => ({ count: current.count + 1 }));
        return Promise.resolve({
          content: [{ type: "text", text: "should not execute" }],
          details: undefined
        });
      }
    };
    const runtime = new AgentRuntime({
      models: _reactModels(),
      project: {
        ..._project(),
        stateDefinitions: [{
          name: RUNTIME_COUNTER.name,
          version: RUNTIME_COUNTER.version,
          schema: RUNTIME_COUNTER.schema,
          schemaFingerprint: "runtime-counter-v1",
          initial: RUNTIME_COUNTER.initial,
          sourcePath: "state/runtime-counter.ts"
        }],
        tools: [tool]
      }
    });
    const persisted: AgentMessage[][] = [];
    const session = await runtime.createSession({
      context: _context("manual-session"),
      executionMode: "manual",
      sessionStore: store,
      persistence: {
        replaceMessages(messages) {
          persisted.push(messages);
        }
      }
    });
    const deferred: string[] = [];
    session.subscribe(event => {
      if (event.type === "tool_calls_deferred") {
        deferred.push(...event.calls.map(call => call.id));
      }
    });

    await session.prompt("hello");

    expect(executions).toBe(0);
    expect((await store.load("manual-session"))?.snapshot.state?.values[
      RUNTIME_COUNTER.name
    ]).toMatchObject({
      schemaFingerprint: "stale-schema",
      value: { count: 2 }
    });
    expect(deferred).toEqual(["call-one"]);
    expect(session.messages.map(message => message.role)).toEqual([
      "user",
      "assistant"
    ]);

    await session.resolveToolResults([
      {
        role: "toolResult",
        toolCallId: "call-one",
        toolName: "echo",
        content: [{ type: "text", text: "echo:hello" }],
        isError: false,
        timestamp: Date.now()
      }
    ]);
    expect(persisted.at(-1)?.map(message => message.role)).toEqual([
      "user",
      "assistant",
      "toolResult"
    ]);
    await session.continue();

    expect(session.messages.map(message => message.role)).toEqual([
      "user",
      "assistant",
      "toolResult",
      "assistant"
    ]);
    expect((await store.load("manual-session"))?.snapshot.state?.values[
      RUNTIME_COUNTER.name
    ]).toMatchObject({
      schemaFingerprint: "stale-schema",
      value: { count: 2 }
    });
  });

  test("executes one real tool batch without a second model turn in autoOnce", async () => {
    let executions = 0;
    const tool: AgentTool = {
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
        executions += 1;
        return Promise.resolve({
          content: [{ type: "text", text: "echo:hello" }],
          details: undefined
        });
      }
    };
    const runtime = new AgentRuntime({
      models: _reactModels(),
      project: { ..._project(), tools: [tool] }
    });
    const session = await runtime.createSession({
      context: _context("auto-once-session"),
      executionMode: "autoOnce"
    });

    await session.prompt("hello");

    expect(executions).toBe(1);
    expect(session.messages.map(message => message.role)).toEqual([
      "user",
      "assistant",
      "toolResult"
    ]);
  });

  test("keeps a host-deferred prepared tool pending during ReAct", async () => {
    const runtime = new AgentRuntime({
      models: _reactModels(),
      project: _project()
    });
    const session = await runtime.createSession({
      context: _context("deferred-session"),
      executionMode: "react",
      extraTools: [
        {
          kind: "deferred",
          definition: {
            name: "echo",
            label: "Echo",
            description: "Echo input through the host.",
            parameters: {
              type: "object",
              properties: { text: { type: "string" } },
              required: ["text"],
              additionalProperties: false
            }
          }
        }
      ]
    });
    const deferred: string[] = [];
    session.subscribe(event => {
      if (event.type === "tool_calls_deferred") {
        deferred.push(...event.calls.map(call => call.id));
      }
    });

    await session.prompt("hello");

    expect(deferred).toEqual(["call-one"]);
    expect(session.messages.map(message => message.role)).toEqual([
      "user",
      "assistant"
    ]);
  });

  test("does not commit automatic step state when a sibling result is deferred", async () => {
    const store = new InMemorySessionStore();
    const runtime = new AgentRuntime({
      models: _reactModels(),
      project: {
        ..._project(),
        stateDefinitions: [{
          name: RUNTIME_COUNTER.name,
          version: RUNTIME_COUNTER.version,
          schema: RUNTIME_COUNTER.schema,
          schemaFingerprint: "runtime-counter-v1",
          initial: RUNTIME_COUNTER.initial,
          sourcePath: "state/runtime-counter.ts"
        }],
        tools: [{
          ..._tool("remember"),
          async execute() {
            RUNTIME_COUNTER.update(() => ({ count: 4 }));
            return {
              content: [{ type: "text" as const, text: "remembered" }],
              details: {}
            };
          }
        }]
      }
    });
    const session = await runtime.createSession({
      context: _context("mixed-deferred-session"),
      extraTools: [{
        kind: "deferred",
        definition: {
          name: "host_action",
          label: "Host action",
          description: "Wait for the Host.",
          parameters: { type: "object", properties: {} }
        }
      }],
      sessionStore: store,
      streamFn: _mixedToolStream
    });

    await session.prompt("hello");

    expect(await store.load("mixed-deferred-session")).toBeNull();
  });

  test("blocks an unavailable definition default but accepts an explicit override", async () => {
    const project = {
      ..._project(),
      definition: {
        model: { provider: "missing", id: "missing-model" },
        reasoning: "high" as const
      }
    };
    const runtime = new AgentRuntime({ models: _reactModels(), project });

    expect(runtime.defaultModel).toEqual({
      selector: { provider: "missing", id: "missing-model" },
      available: false
    });
    try {
      await runtime.createSession({ context: _context("missing-session") });
      throw new Error("Expected the unavailable default to reject.");
    } catch (error) {
      expect(error).toMatchObject({
        name: "AgentRuntimeModelUnavailableError",
        selector: { provider: "missing", id: "missing-model" }
      });
    }
    const session = await runtime.createSession({
      context: _context("override-session"),
      model: { provider: "fake", id: "fake-model" }
    });
    expect(session.model).toEqual({ provider: "fake", id: "fake-model" });
  });

  test("distinguishes an omitted reasoning override from provider default", async () => {
    const runtime = new AgentRuntime({
      models: _reactModels(),
      project: _project()
    });

    const inherited = await runtime.createSession({
      context: _context("inherited-session")
    });
    const providerDefault = await runtime.createSession({
      context: _context("provider-default-session"),
      reasoning: undefined
    });

    expect(inherited.reasoning).toBe("high");
    expect(providerDefault.reasoning).toBeUndefined();
  });

  test("rejects non-plain project tool definitions instead of sharing them", () => {
    class StatefulTool implements AgentTool {
      name = "stateful";
      label = "Stateful";
      description = "Stateful class tool.";
      parameters = { type: "object" as const, properties: {} };

      async execute() {
        return Promise.resolve({
          content: [{ type: "text" as const, text: "done" }],
          details: {}
        });
      }
    }

    expect(
      () =>
        new AgentRuntime({
          models: _models(),
          project: { ..._project(), tools: [new StatefulTool()] }
        })
    ).toThrow("plain data objects");
  });
});

const RUNTIME_COUNTER = defineState({
  name: "test.runtime-counter",
  version: 1,
  schema: Type.Object({ count: Type.Number() }),
  initial: { count: 0 }
});

function _context(id: string) {
  const principal = {
    issuer: "test",
    principalId: "runtime-test",
    principalType: "runtime" as const
  };
  return {
    id,
    auth: { initiator: principal, current: principal },
    channel: { kind: "test" },
    turn: { id: `turn-${id}`, sequence: 1 }
  };
}

function _project(): AgentProjectSnapshot {
  return {
    root: "/agent",
    definition: {
      model: { provider: "fake", id: "fake-model" },
      reasoning: "high"
    },
    instructions: "Test agent.",
    tools: [],
    connections: [],
    resources: { skills: [] },
    diagnostics: [],
    fingerprint: "snapshot-one"
  };
}

function _tool(name: string): AgentTool {
  return {
    name,
    label: name,
    description: name,
    parameters: { type: "object", properties: {} },
    execute: async () =>
      Promise.resolve({ content: [{ type: "text", text: "" }], details: {} })
  };
}

function _models(): Models {
  return {
    getModel(provider: string, id: string) {
      return provider === "fake" && id === "fake-model"
        ? { provider, id }
        : undefined;
    }
  } as unknown as Models;
}

function _reactModels(): Models {
  const model: Model<"fake"> = {
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
  const api = {
    stream: (_model: Model<Api>, context: Context) => _stream(context),
    streamSimple: (_model: Model<Api>, context: Context) => _stream(context)
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
  const hasToolResult = context.messages.at(-1)?.role === "toolResult";
  const message: AssistantMessage = {
    role: "assistant",
    content: hasToolResult
      ? [{ type: "text", text: "done" }]
      : [
        {
          type: "toolCall",
          id: "call-one",
          name: "echo",
          arguments: { text: "hello" }
        }
      ],
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
    stopReason: hasToolResult ? "stop" : "toolUse",
    timestamp: Date.now()
  };
  queueMicrotask(() => {
    stream.push({ type: "start", partial: message });
    stream.push({
      type: "done",
      reason: hasToolResult ? "stop" : "toolUse",
      message
    });
  });
  return stream;
}

function _mixedToolStream(_model: Model<Api>, context: Context) {
  const stream = createAssistantMessageEventStream();
  const hasToolResult = context.messages.at(-1)?.role === "toolResult";
  const message: AssistantMessage = {
    role: "assistant",
    content: hasToolResult ? [{ type: "text", text: "done" }] : [
      {
        type: "toolCall",
        id: "call-remember",
        name: "remember",
        arguments: {}
      },
      {
        type: "toolCall",
        id: "call-host",
        name: "host_action",
        arguments: {}
      }
    ],
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
    stopReason: hasToolResult ? "stop" : "toolUse",
    timestamp: Date.now()
  };
  queueMicrotask(() => {
    stream.push({ type: "start", partial: message });
    stream.push({
      type: "done",
      reason: hasToolResult ? "stop" : "toolUse",
      message
    });
  });
  return stream;
}

async function _rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("Expected operation to reject");
}
