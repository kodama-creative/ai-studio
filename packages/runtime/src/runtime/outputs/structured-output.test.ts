import {
  type Api,
  type AssistantMessage,
  type Context,
  createAssistantMessageEventStream,
  createModels,
  createProvider,
  type Model
} from "@earendil-works/pi-ai";
import { describe, expect, test } from "bun:test";
import { Type } from "typebox";

import type { AgentTool } from "@earendil-works/pi-agent-core";

import { StructuredOutputError } from "./structured-output-error";
import { AgentRuntime } from "../agent/agent-runtime";

import type { AgentProjectSnapshot } from "../agent/agent-project-snapshot";

describe("named structured output", () => {
  test("terminates with one schema-valid Pi tool result in react and manual modes", async () => {
    for (const executionMode of ["react", "manual"] as const) {
      const runtime = _runtime(_toolStream([
        _call("final_output", { answer: "Ada" })
      ]));
      const session = await runtime.createSession({
        capabilityPolicy: _policy(),
        context: _context(`valid-${executionMode}`),
        executionMode,
        outputContract: "answer"
      });

      await session.prompt("Who?");

      expect(session.structuredOutput).toEqual({
        contract: "answer",
        schemaFingerprint: "a".repeat(64),
        value: { answer: "Ada" }
      });
      expect(session.messages.map(message => message.role)).toEqual([
        "user",
        "assistant",
        "toolResult"
      ]);
      expect(JSON.stringify(session.messages)).toContain("structuredOutput");
    }
  });

  test("fails once when the result is missing or schema-invalid", async () => {
    const missingRuntime = _runtime(_textStream("plain answer"));
    const missing = await missingRuntime.createSession({
      capabilityPolicy: _policy(),
      context: _context("missing"),
      outputContract: "answer"
    });
    expect(await _rejection(missing.prompt("Who?"))).toMatchObject({
      code: "structured_output_missing"
    });

    let invalidProviderCalls = 0;
    const invalidRuntime = _runtime((model, context) => {
      invalidProviderCalls += 1;
      return _toolStream([
        _call("final_output", { answer: 42 })
      ])(model, context);
    });
    const invalid = await invalidRuntime.createSession({
      capabilityPolicy: _policy(),
      context: _context("invalid"),
      outputContract: "answer"
    });
    expect(await _rejection(invalid.prompt("Who?"))).toMatchObject({
      code: "structured_output_invalid"
    });
    expect(invalidProviderCalls).toBe(1);
  });

  test("rejects duplicate or mixed final output before any sibling executes", async () => {
    let executions = 0;
    const ordinary: AgentTool = {
      name: "ordinary",
      label: "Ordinary",
      description: "Must not execute.",
      parameters: Type.Object({}),
      async execute() {
        executions += 1;
        return { content: [{ type: "text", text: "ran" }], details: {} };
      }
    };
    for (const calls of [
      [
        _call("ordinary", {}),
        _call("final_output", { answer: "Ada" })
      ],
      [
        _call("final_output", { answer: "Ada" }, "final-one"),
        _call("final_output", { answer: "Grace" }, "final-two")
      ]
    ]) {
      const runtime = _runtime(_toolStream(calls), [ordinary]);
      const session = await runtime.createSession({
        capabilityPolicy: _policy(),
        context: _context(crypto.randomUUID()),
        outputContract: "answer"
      });
      expect(await _rejection(session.prompt("Who?"))).toMatchObject({
        code: "structured_output_invalid"
      });
    }
    expect(executions).toBe(0);
  });

  test("enforces the Host byte limit and reserved tool boundary", async () => {
    const runtime = _runtime(_toolStream([
      _call("final_output", { answer: "x".repeat(2_000) })
    ]), [], 1_024);
    const session = await runtime.createSession({
      capabilityPolicy: _policy(),
      context: _context("too-large"),
      outputContract: "answer"
    });
    expect(await _rejection(session.prompt("Who?"))).toMatchObject({
      code: "structured_output_too_large"
    });
    expect(() => _runtime(_textStream("x"), [], 1_023)).toThrow(
      "maxStructuredOutputBytes"
    );
    const collision = _runtime(_textStream("x"));
    expect(await _rejection(collision.createSession({
      capabilityPolicy: _policy(),
      context: _context("collision"),
      extraTools: [{
        kind: "deferred",
        definition: {
          name: "final_output",
          label: "Collision",
          description: "Collision.",
          parameters: Type.Object({})
        }
      }]
    }))).toMatchObject({ message: expect.stringContaining("reserved") });
  });

  test("rejects unknown caller-selected contract names before inference", async () => {
    const runtime = _runtime(() => {
      throw new Error("provider must not run");
    });
    expect(await _rejection(runtime.createSession({
      capabilityPolicy: _policy(),
      context: _context("unknown"),
      outputContract: "caller-schema"
    }))).toMatchObject({
      message: "Unknown structured output contract: caller-schema"
    });
  });
});

function _runtime(
  streamFn: (model: Model<Api>, context: Context) => ReturnType<
    typeof createAssistantMessageEventStream
  >,
  tools: AgentTool[] = [],
  maxStructuredOutputBytes?: number
) {
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
  const provider = createProvider({
    id: "fake",
    auth: { apiKey: { name: "Fake", resolve: async () => ({ auth: {} }) } },
    models: [model],
    api: { stream: streamFn, streamSimple: streamFn }
  });
  const models = createModels();
  models.setProvider(provider);
  return new AgentRuntime({
    models,
    project: _project(tools),
    ...(maxStructuredOutputBytes ? { maxStructuredOutputBytes } : {})
  });
}

function _project(tools: AgentTool[]): AgentProjectSnapshot {
  return {
    root: "/agent",
    definition: { model: { provider: "fake", id: "fake-model" } },
    instructions: "Return the selected structured output.",
    tools,
    connections: [],
    outputDefinitions: [{
      name: "answer",
      description: "The final answer.",
      schema: Type.Object({ answer: Type.String() }),
      schemaFingerprint: "a".repeat(64),
      sourcePath: "outputs/answer.ts"
    }],
    resources: {},
    diagnostics: [],
    fingerprint: "snapshot-output"
  };
}

function _policy() {
  return {
    connectionContributions: [],
    modelOptions: {},
    models: [{ provider: "fake", id: "fake-model" }],
    reasoning: ["off", "minimal", "low", "medium", "high", "xhigh"] as const,
    toolContributions: ["tool:ordinary"]
  };
}

function _context(id: string) {
  const principal = {
    issuer: "test",
    principalId: "test",
    principalType: "runtime" as const
  };
  return {
    id,
    auth: { initiator: principal, current: principal },
    channel: { kind: "test" },
    turn: { id: `turn-${id}`, sequence: 1 }
  };
}

function _call(
  name: string,
  args: Record<string, unknown>,
  id = `call-${name}`
) {
  return { type: "toolCall" as const, id, name, arguments: args };
}

function _toolStream(calls: Array<ReturnType<typeof _call>>) {
  return (_model: Model<Api>, _context: Context) => _stream({
    content: calls,
    stopReason: "toolUse"
  });
}

function _textStream(text: string) {
  return (_model: Model<Api>, _context: Context) => _stream({
    content: [{ type: "text", text }],
    stopReason: "stop"
  });
}

function _stream(input: {
  content: AssistantMessage["content"];
  stopReason: "stop" | "toolUse";
}) {
  const stream = createAssistantMessageEventStream();
  const message: AssistantMessage = {
    role: "assistant",
    ...input,
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
    timestamp: Date.now()
  };
  queueMicrotask(() => {
    stream.push({ type: "start", partial: message });
    stream.push({ type: "done", reason: input.stopReason, message });
  });
  return stream;
}

async function _rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    return error;
  }
  throw new StructuredOutputError(
    "structured_output_missing",
    "Expected operation to reject"
  );
}
