import type { AgentMessage, AgentTool } from "@earendil-works/pi-agent-core";
import {
  createAssistantMessageEventStream,
  createModels,
  createProvider,
  type Api,
  type AssistantMessage,
  type Context,
  type Model,
  type Models,
} from "@earendil-works/pi-ai";
import { describe, expect, test } from "bun:test";

import type { AgentProjectSnapshot } from "./agent-project-snapshot";
import { AgentRuntime } from "./agent-runtime";

describe("AgentRuntime", () => {
  test("owns an immutable project and its definition default", () => {
    const project = _project();
    (project.tools as AgentTool[]).push(_tool("original-tool"));

    const runtime = new AgentRuntime({ models: _models(), project });

    expect(runtime.project).not.toBe(project);
    (project.definition!.model as { id: string }).id = "mutated-model";
    (project.tools[0] as { name: string }).name = "mutated-tool";
    (project.tools as AgentTool[]).push(_tool("late-tool"));
    expect(runtime.project.definition?.model.id).toBe("fake-model");
    expect(runtime.project.tools.map((tool) => tool.name)).toEqual([
      "original-tool",
    ]);
    expect(Object.isFrozen(runtime.project)).toBe(true);
    expect(Object.isFrozen(runtime.project.definition?.model)).toBe(true);
    expect(Object.isFrozen(runtime.project.tools)).toBe(true);
    expect(Object.isFrozen(runtime.project.tools[0])).toBe(true);
    expect(runtime.defaultModel).toEqual({
      selector: { provider: "fake", id: "fake-model" },
      available: true,
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
        additionalProperties: false,
      },
      execute(_toolCallId, input) {
        executions += 1;
        return Promise.resolve({
          content: [
            {
              type: "text",
              text: `echo:${(input as { text: string }).text}`,
            },
          ],
          details: undefined,
        });
      },
    };
    const persisted: AgentMessage[][] = [];
    const runtime = new AgentRuntime({
      models: _reactModels(),
      project: { ..._project(), tools: [tool] },
    });

    const session = await runtime.createSession({
      id: "thread-one",
      executionMode: "react",
      persistence: {
        replaceMessages(messages) {
          persisted.push(messages);
        },
      },
    });
    await session.prompt("hello");

    expect(executions).toBe(1);
    expect(persisted.at(-1)?.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "toolResult",
      "assistant",
    ]);
    expect(session.model).toEqual({ provider: "fake", id: "fake-model" });
  });

  test("keeps manual placeholders internal and continues from resolved results", async () => {
    let executions = 0;
    const tool: AgentTool = {
      name: "echo",
      label: "Echo",
      description: "Echo input.",
      parameters: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
        additionalProperties: false,
      },
      execute() {
        executions += 1;
        return Promise.resolve({
          content: [{ type: "text", text: "should not execute" }],
          details: undefined,
        });
      },
    };
    const runtime = new AgentRuntime({
      models: _reactModels(),
      project: { ..._project(), tools: [tool] },
    });
    const persisted: AgentMessage[][] = [];
    const session = await runtime.createSession({
      executionMode: "manual",
      persistence: {
        replaceMessages(messages) {
          persisted.push(messages);
        },
      },
    });
    const deferred: string[] = [];
    session.subscribe((event) => {
      if (event.type === "tool_calls_deferred") {
        deferred.push(...event.calls.map((call) => call.id));
      }
    });

    await session.prompt("hello");

    expect(executions).toBe(0);
    expect(deferred).toEqual(["call-one"]);
    expect(session.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
    ]);

    await session.resolveToolResults([
      {
        role: "toolResult",
        toolCallId: "call-one",
        toolName: "echo",
        content: [{ type: "text", text: "echo:hello" }],
        isError: false,
        timestamp: Date.now(),
      },
    ]);
    expect(persisted.at(-1)?.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "toolResult",
    ]);
    await session.continue();

    expect(session.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "toolResult",
      "assistant",
    ]);
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
        additionalProperties: false,
      },
      execute() {
        executions += 1;
        return Promise.resolve({
          content: [{ type: "text", text: "echo:hello" }],
          details: undefined,
        });
      },
    };
    const runtime = new AgentRuntime({
      models: _reactModels(),
      project: { ..._project(), tools: [tool] },
    });
    const session = await runtime.createSession({ executionMode: "autoOnce" });

    await session.prompt("hello");

    expect(executions).toBe(1);
    expect(session.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "toolResult",
    ]);
  });

  test("keeps a host-deferred prepared tool pending during ReAct", async () => {
    const runtime = new AgentRuntime({
      models: _reactModels(),
      project: _project(),
    });
    const session = await runtime.createSession({
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
              additionalProperties: false,
            },
          },
        },
      ],
    });
    const deferred: string[] = [];
    session.subscribe((event) => {
      if (event.type === "tool_calls_deferred") {
        deferred.push(...event.calls.map((call) => call.id));
      }
    });

    await session.prompt("hello");

    expect(deferred).toEqual(["call-one"]);
    expect(session.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
    ]);
  });

  test("blocks an unavailable definition default but accepts an explicit override", async () => {
    const project = {
      ..._project(),
      definition: {
        model: { provider: "missing", id: "missing-model" },
        reasoning: "high" as const,
      },
    };
    const runtime = new AgentRuntime({ models: _reactModels(), project });

    expect(runtime.defaultModel).toEqual({
      selector: { provider: "missing", id: "missing-model" },
      available: false,
    });
    try {
      await runtime.createSession();
      throw new Error("Expected the unavailable default to reject.");
    } catch (error) {
      expect(error).toMatchObject({
        name: "AgentRuntimeModelUnavailableError",
        selector: { provider: "missing", id: "missing-model" },
      });
    }
    const session = await runtime.createSession({
      model: { provider: "fake", id: "fake-model" },
    });
    expect(session.model).toEqual({ provider: "fake", id: "fake-model" });
  });

  test("distinguishes an omitted reasoning override from provider default", async () => {
    const runtime = new AgentRuntime({
      models: _reactModels(),
      project: _project(),
    });

    const inherited = await runtime.createSession();
    const providerDefault = await runtime.createSession({
      reasoning: undefined,
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

      execute() {
        return Promise.resolve({
          content: [{ type: "text" as const, text: "done" }],
          details: {},
        });
      }
    }

    expect(
      () =>
        new AgentRuntime({
          models: _models(),
          project: { ..._project(), tools: [new StatefulTool()] },
        })
    ).toThrow("plain data objects");
  });
});

function _project(): AgentProjectSnapshot {
  return {
    root: "/agent",
    definition: {
      model: { provider: "fake", id: "fake-model" },
      reasoning: "high",
    },
    instructions: "Test agent.",
    tools: [],
    connections: [],
    resources: { skills: [] },
    diagnostics: [],
    fingerprint: "snapshot-one",
  };
}

function _tool(name: string): AgentTool {
  return {
    name,
    label: name,
    description: name,
    parameters: { type: "object", properties: {} },
    execute: () =>
      Promise.resolve({ content: [{ type: "text", text: "" }], details: {} }),
  };
}

function _models(): Models {
  return {
    getModel(provider: string, id: string) {
      return provider === "fake" && id === "fake-model"
        ? { provider, id }
        : undefined;
    },
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
    maxTokens: 4_096,
  };
  const api = {
    stream: (_model: Model<Api>, context: Context) => _stream(context),
    streamSimple: (_model: Model<Api>, context: Context) => _stream(context),
  };
  const provider = createProvider({
    id: "fake",
    auth: {
      apiKey: {
        name: "Fake",
        resolve: () => Promise.resolve({ auth: {} }),
      },
    },
    models: [model],
    api,
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
            arguments: { text: "hello" },
          },
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
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: hasToolResult ? "stop" : "toolUse",
    timestamp: Date.now(),
  };
  queueMicrotask(() => {
    stream.push({ type: "start", partial: message });
    stream.push({
      type: "done",
      reason: hasToolResult ? "stop" : "toolUse",
      message,
    });
  });
  return stream;
}
