import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

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

import { ExternalAgentProjectManager } from "../external-projects";

import { StreamThreadController } from "./stream-thread";

const roots: string[] = [];
const managers: ExternalAgentProjectManager[] = [];

afterEach(async () => {
  await Promise.all(managers.splice(0).map((manager) => manager.shutdown()));
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true }))
  );
});

describe("StreamThreadController Agent Project runtime", () => {
  test("streams a complete Pi Agent ReAct run from the immutable project runtime", async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "llm-space-stream-runtime-")
    );
    roots.push(root);
    const home = path.join(root, "home");
    const workspace = path.join(home, "workspace");
    const project = path.join(root, "project");
    const agent = path.join(project, "agent");
    await mkdir(path.join(agent, "tools"), { recursive: true });
    await mkdir(workspace, { recursive: true });
    await writeFile(
      path.join(project, "llm-space.json"),
      JSON.stringify({ schemaVersion: 1, agent: "./agent" })
    );
    await writeFile(
      path.join(agent, "agent.ts"),
      `export default { model: "fake/fake-model", reasoning: "high" };`
    );
    await writeFile(path.join(agent, "instructions.md"), "Use echo.\n");
    await writeFile(
      path.join(agent, "tools", "echo.ts"),
      `export default {
        name: "echo",
        label: "Echo",
        description: "Echo text.",
        parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
        async execute(_id, { text }) { return { content: [{ type: "text", text }], details: {} }; }
      };`
    );
    const models = _models();
    const manager = new ExternalAgentProjectManager({
      homePath: home,
      workspaceRoot: workspace,
      getModels: () => Promise.resolve(models),
    });
    managers.push(manager);
    const opened = await manager.trustAndOpen(project);
    const threadId = opened.threads[0].id;
    const events: string[] = [];
    const controller = new StreamThreadController(
      {
        getAvailableModels: () => Promise.resolve(models),
        getBaseUrl: () => undefined,
        getHeaders: () => undefined,
        isBuiltin: () => false,
        isBuiltinCatalogModel: () => false,
      } as never,
      { capture: () => undefined } as never,
      manager
    );

    await controller.run(
      {
        streamId: "stream-one",
        runtime: {
          type: "agentProject",
          projectId: opened.id,
          threadId,
          executionMode: "react",
        },
        request: {
          model: { provider: "fake", id: "fake-model" },
          config: { model: { reasoning: "high" } },
          context: {
            systemPrompt: opened.instructions,
            messages: [
              {
                role: "user",
                content: [{ type: "text", text: "hello" }],
                timestamp: Date.now(),
              },
            ],
            tools: opened.tools,
            sourceTools: opened.tools,
          },
        },
      },
      (message) =>
        events.push(
          message.type === "event" ? message.event.type : message.type
        )
    );

    expect(events).toContain("tool_execution_end");
    expect(events.at(-1)).toBe("done");
  });
});

function _models() {
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
  const hasResult = context.messages.at(-1)?.role === "toolResult";
  const message: AssistantMessage = {
    role: "assistant",
    content: hasResult
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
    stopReason: hasResult ? "stop" : "toolUse",
    timestamp: Date.now(),
  };
  queueMicrotask(() => {
    stream.push({ type: "start", partial: message });
    stream.push({
      type: "done",
      reason: hasResult ? "stop" : "toolUse",
      message,
    });
  });
  return stream;
}
