import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createAssistantMessageEventStream,
  createModels,
  createProvider,
  type Api,
  type AssistantMessage,
  type Context,
  type Model,
} from "@earendil-works/pi-ai";
import { afterEach, describe, expect, test } from "bun:test";

import { LocalAgentRuntime } from "./local-agent-runtime";

const ROOTS: string[] = [];

afterEach(async () => {
  await Promise.all(
    ROOTS.splice(0).map((root) => rm(root, { recursive: true }))
  );
});

describe("LocalAgentRuntime", () => {
  test("builds from the required definition before creating sessions", async () => {
    const agentRoot = await _fixture();
    let executions = 0;
    await writeFile(
      join(agentRoot, "tools", "echo.ts"),
      `import { defineTool } from "@llm-space/runtime/tools";
      import { Type } from "typebox";

      export default defineTool({
        description: "Echo text.",
        inputSchema: Type.Object({ text: Type.String() }),
        execute(input) {
          return { text: "echo:" + input.text, echoed: input.text };
        }
      });`
    );
    const runtime = await LocalAgentRuntime.create({
      agentRoot,
      models: _fakeModels(() => {
        executions += 1;
      }),
    });

    const session = await runtime.createSession({ id: "thread-one" });
    await session.prompt("hello");

    expect(runtime.project.definition).toEqual({
      model: { provider: "fake", id: "fake-model" },
      reasoning: "high",
    });
    expect(session.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "toolResult",
      "assistant",
    ]);
    expect(executions).toBe(2);
  });
});

async function _fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "llm-space-runtime-session-"));
  ROOTS.push(root);
  await mkdir(join(root, "tools"), { recursive: true });
  await writeFile(
    join(root, "agent.ts"),
    `export default { model: "fake/fake-model", reasoning: "high" };`
  );
  await writeFile(join(root, "instructions.md"), "Always use echo.\n");
  return root;
}

function _fakeModels(onStream: () => void) {
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
    maxTokens: 4_096,
  };
  const api = {
    stream: (_model: Model<Api>, context: Context) => {
      onStream();
      return _fakeStream(context);
    },
    streamSimple: (_model: Model<Api>, context: Context) => {
      onStream();
      return _fakeStream(context);
    },
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

function _fakeStream(context: Context) {
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
