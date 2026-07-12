import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AgentTool } from "@earendil-works/pi-agent-core";
import {
  createAssistantMessageEventStream,
  createModels,
  createProvider,
  Type,
  type Api,
  type AssistantMessage,
  type Context,
  type Model,
} from "@earendil-works/pi-ai";
import { afterEach, describe, expect, test } from "bun:test";

import { LocalAgentRuntime } from "./local-agent-runtime";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true }))
  );
});

describe("LocalAgentRuntime", () => {
  test("executes project tools and reopens the persistent Pi session", async () => {
    const root = await _fixture();
    const agentRoot = join(root, "agent");
    const sessionsRoot = join(root, ".llm-space", "sessions");
    await mkdir(join(agentRoot, "tools"), { recursive: true });
    await writeFile(
      join(agentRoot, "instructions.md"),
      "Always use the echo tool before answering.\n"
    );
    await writeFile(
      join(agentRoot, "tools", "echo.ts"),
      `export default {
        name: "echo",
        label: "Echo",
        description: "Echo text.",
        parameters: {
          type: "object",
          properties: { text: { type: "string" } },
          required: ["text"],
          additionalProperties: false
        },
        async execute(_toolCallId, input) {
          return {
            content: [{ type: "text", text: "echo:" + input.text }],
            details: { echoed: input.text }
          };
        }
      };`
    );
    const models = _fakeModels();
    const runtime = new LocalAgentRuntime({ agentRoot, sessionsRoot, models });
    const session = await runtime.createSession({
      id: "session-one",
      model: { provider: "fake", id: "fake-model" },
    });
    const eventTypes: string[] = [];
    session.subscribe((event) => {
      eventTypes.push(event.type);
    });

    await session.prompt("hello");

    expect(eventTypes).toContain("tool_execution_end");
    expect(eventTypes.at(-1)).toBe("settled");
    const listed = await runtime.listSessions();
    expect(listed).toHaveLength(1);
    await runtime.cleanup();

    const reopenedRuntime = new LocalAgentRuntime({
      agentRoot,
      sessionsRoot,
      models,
    });
    const reopenedMetadata = (await reopenedRuntime.listSessions())[0]!;
    const reopened = await reopenedRuntime.openSession({
      metadata: reopenedMetadata,
      model: { provider: "fake", id: "fake-model" },
    });
    await reopened.prompt("again");

    expect(reopenedMetadata.path).toContain("session-one");
    expect(await reopenedRuntime.listSessions()).toHaveLength(1);
    await reopenedRuntime.cleanup();
  });

  test("composes host tools with project tools for a real agent session", async () => {
    const root = await _fixture();
    const agentRoot = join(root, "agent");
    await mkdir(join(agentRoot, "tools"), { recursive: true });
    await writeFile(
      join(agentRoot, "instructions.md"),
      "Use available tools.\n"
    );
    await writeFile(
      join(agentRoot, "tools", "echo.ts"),
      `export default {
        name: "echo",
        label: "Echo",
        description: "Echo text.",
        parameters: { type: "object", properties: {}, additionalProperties: false },
        async execute() { return { content: [{ type: "text", text: "project" }] }; }
      };`
    );
    const parameters = Type.Object({});
    const builderProbe: AgentTool<typeof parameters> = {
      name: "builder_probe",
      label: "Builder probe",
      description: "Host-injected Builder capability.",
      parameters,
      execute: () =>
        Promise.resolve({
          content: [{ type: "text", text: "builder" }],
          details: undefined,
        }),
    };
    const runtime = new LocalAgentRuntime({
      agentRoot,
      sessionsRoot: join(root, ".llm-space", "sessions"),
      models: _fakeModels(["builder_probe", "echo"]),
    });
    const session = await runtime.createSession({
      model: { provider: "fake", id: "fake-model" },
      extraTools: [builderProbe],
    });
    const executed: string[] = [];
    session.subscribe((event) => {
      if (event.type === "tool_execution_end") executed.push(event.toolName);
    });

    await session.prompt("use builder");
    await session.prompt("use target");

    expect(executed).toEqual(["builder_probe", "echo"]);
    await runtime.cleanup();
  });
});

async function _fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "llm-space-runtime-session-"));
  roots.push(root);
  return root;
}

function _fakeModels(toolNames: string[] = []) {
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
  let toolIndex = 0;
  const nextTool = () => toolNames[toolIndex++] ?? "echo";
  const api = {
    stream: (_model: Model<Api>, context: Context) =>
      _fakeStream(context, nextTool()),
    streamSimple: (_model: Model<Api>, context: Context) =>
      _fakeStream(context, nextTool()),
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

function _fakeStream(context: Context, toolName: string) {
  const stream = createAssistantMessageEventStream();
  const hasToolResult = context.messages.at(-1)?.role === "toolResult";
  const content = hasToolResult
    ? [{ type: "text" as const, text: "done" }]
    : [
        {
          type: "toolCall" as const,
          id: `call-${context.messages.length}`,
          name: toolName,
          arguments: { text: "hello" },
        },
      ];
  const message: AssistantMessage = {
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
