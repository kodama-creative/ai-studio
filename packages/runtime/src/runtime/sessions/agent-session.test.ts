import {
  type Api,
  type AssistantMessage,
  type Context,
  createAssistantMessageEventStream,
  type Model,
  type Models,
  type ToolResultMessage
} from "@earendil-works/pi-ai";
import { describe, expect, test } from "bun:test";

import type {
  AgentMessage,
  StreamFn
} from "@earendil-works/pi-agent-core";

import { AgentRuntime } from "../agent/agent-runtime";

import type { AgentProjectSnapshot } from "../agent/agent-project-snapshot";

describe("AgentSession Pi Agent ownership", () => {
  test("reloads a settled manual tool call and continues without a user turn", async () => {
    const runtime = _runtime();
    let persisted: AgentMessage[] = [];
    const persistence = {
      replaceMessages(messages: AgentMessage[]) {
        persisted = messages;
      }
    };
    const firstSession = await runtime.createSession({
      context: _context("manual-session"),
      executionMode: "manual",
      persistence,
      streamFn: _manualStream
    });

    await firstSession.prompt("hello");

    expect(persisted.map(message => message.role)).toEqual([
      "user",
      "assistant"
    ]);

    const reloadedSession = await runtime.createSession({
      context: _context("manual-session"),
      executionMode: "manual",
      initialMessages: persisted,
      persistence,
      streamFn: _manualStream
    });
    await reloadedSession.resolveToolResults([_toolResult()]);
    await reloadedSession.continue();

    expect(reloadedSession.messages.map(message => message.role)).toEqual([
      "user",
      "assistant",
      "toolResult",
      "assistant"
    ]);
    expect(
      reloadedSession.messages.filter(message => message.role === "user")
    ).toHaveLength(1);
    expect(reloadedSession.messages[2]).toMatchObject({
      role: "toolResult",
      toolCallId: "call-one",
      toolName: "echo"
    });
  });

  test("persists the public transcript before publishing agent_end", async () => {
    const order: string[] = [];
    const session = await _runtime().createSession({
      context: _context("persistence-session"),
      persistence: {
        replaceMessages(messages) {
          order.push(`persist:${messages.map(message => message.role).join(",")}`);
        }
      },
      streamFn: _stoppedStream
    });
    session.subscribe(event => {
      if (event.type === "agent_end") {
        order.push("agent_end");
      }
    });

    await session.prompt("hello");

    expect(order.slice(-2)).toEqual([
      "persist:user,assistant",
      "agent_end"
    ]);
  });

  test("aborts the Pi Agent run and settles after terminal persistence", async () => {
    let activeSignal: AbortSignal | undefined;
    let markStarted: () => void = () => {};
    const started = new Promise<void>(resolve => {
      markStarted = resolve;
    });
    const events: string[] = [];
    const persisted: AgentMessage[][] = [];
    const streamFn: StreamFn = (_model, _context, options) => {
      activeSignal = options?.signal;
      const stream = createAssistantMessageEventStream();
      const partial = _assistant([], "stop");
      stream.push({ type: "start", partial });
      options?.signal?.addEventListener(
        "abort",
        () => {
          stream.push({
            type: "error",
            reason: "aborted",
            error: {
              ...partial,
              stopReason: "aborted",
              errorMessage: "aborted"
            }
          });
        },
        { once: true }
      );
      markStarted();
      return stream;
    };
    const session = await _runtime().createSession({
      context: _context("abort-session"),
      persistence: {
        replaceMessages(messages) {
          persisted.push(messages);
        }
      },
      streamFn
    });
    session.subscribe(event => {
      events.push(event.type);
    });

    const running = session.prompt("hello");
    await started;
    session.abort();
    await running;
    await session.waitForIdle();

    expect(activeSignal?.aborted).toBe(true);
    expect(session.messages.at(-1)).toMatchObject({
      role: "assistant",
      stopReason: "aborted"
    });
    expect(persisted.at(-1)?.at(-1)).toMatchObject({
      role: "assistant",
      stopReason: "aborted"
    });
    expect(events.at(-1)).toBe("agent_end");
  });
});

function _runtime(): AgentRuntime {
  return new AgentRuntime({ models: _models(), project: _project() });
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
    tools: [
      {
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
          return {
            content: [{ type: "text", text: "should not run in manual" }],
            details: undefined
          };
        }
      }
    ],
    connections: [],
    resources: { skills: [] },
    diagnostics: [],
    fingerprint: "snapshot-one"
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
      : _assistant(
        [
          {
            type: "toolCall",
            id: "call-one",
            name: "echo",
            arguments: { text: "hello" }
          }
        ],
        "toolUse"
      )
  );
}

function _stoppedStream() {
  return _completedStream(
    _assistant([{ type: "text", text: "done" }], "stop")
  );
}

function _completedStream(message: AssistantMessage) {
  const stream = createAssistantMessageEventStream();
  queueMicrotask(() => {
    stream.push({ type: "start", partial: message });
    stream.push({
      type: "done",
      reason: message.stopReason === "toolUse" ? "toolUse" : "stop",
      message
    });
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
    timestamp: Date.now()
  };
}

function _toolResult(): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId: "call-one",
    toolName: "echo",
    content: [{ type: "text", text: "echo:hello" }],
    isError: false,
    timestamp: Date.now()
  };
}
