import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  type Api,
  type AssistantMessage,
  type Context,
  createAssistantMessageEventStream,
  createModels,
  createProvider,
  type Model
} from "@earendil-works/pi-ai";
import { afterEach, describe, expect, test } from "bun:test";

import type {
  BuiltinTool,
  McpTool,
  ThreadAgentRuntimeProvenance
} from "@llm-space/core";

import { StreamThreadController } from "./stream-thread";
import { ExternalAgentProjectManager } from "../external-projects";

const roots: string[] = [];
const managers: ExternalAgentProjectManager[] = [];

afterEach(async () => {
  await Promise.all(managers.splice(0).map(async manager => manager.shutdown()));
  await Promise.all(
    roots.splice(0).map(async root => rm(root, { recursive: true }))
  );
});

describe("StreamThreadController Agent Project runtime", () => {
  test("streams a complete Pi Agent ReAct run from the immutable project runtime", async () => {
    const { models, manager, opened, threadId } = await _fixture({
      instructions: "Use echo.\n",
      projectTool: true
    });
    const events: string[] = [];
    let runtimeProvenance: ThreadAgentRuntimeProvenance | undefined;
    const controller = new StreamThreadController(
      _modelManager(models),
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
          modelSource: "agent"
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
                timestamp: Date.now()
              }
            ],
            tools: opened.tools,
            sourceTools: opened.tools
          }
        }
      },
      message => {
        if (message.type === "runtime") {
          runtimeProvenance = message.runtime;
        }
        events.push(
          message.type === "event" ? message.event.type : message.type
        );
      }
    );

    expect(runtimeProvenance).toEqual({
      projectId: opened.id,
      snapshot: opened.snapshot,
      definitionFingerprint: opened.definitionFingerprint,
      modelSource: "agent"
    });
    expect(events).toContain("tool_execution_end");
    expect(events.at(-1)).toBe("done");
    const persisted = await manager.readThread(opened.id, threadId);
    expect(
      persisted.thread.context?.messages?.map(message => message.role)
    ).toEqual(["user", "assistant", "assistant"]);
    expect(
      persisted.thread.context?.messages?.[1]?.role === "assistant"
        ? persisted.thread.context.messages[1].toolCalls?.[0]?.output
        : undefined
    ).toMatchObject({
      content: [{ type: "text", text: "hello" }]
    });
  });

  test("leaves a dangerous bash call pending in the runtime ReAct loop", async () => {
    const { models, manager, opened, threadId } = await _fixture({
      instructions: "Be careful.\n",
      toolCall: {
        name: "bash",
        arguments: { command: "rm -rf /tmp/should-not-run" }
      }
    });
    let executions = 0;
    const controller = new StreamThreadController(
      _modelManager(models),
      { capture: () => undefined } as never,
      manager,
      undefined,
      {
        call: async () => {
          executions += 1;
          return Promise.resolve({ contentText: "executed", isError: false });
        }
      } as never
    );
    const bashTool: BuiltinTool = {
      type: "builtin",
      name: "bash",
      description: "Execute a shell command.",
      parameters: {
        type: "object",
        properties: { command: { type: "string" } },
        required: ["command"]
      }
    };

    await controller.run(
      {
        streamId: "stream-risky-bash",
        runtime: {
          type: "agentProject",
          projectId: opened.id,
          threadId,
          executionMode: "react",
          modelSource: "agent"
        },
        request: {
          model: { provider: "fake", id: "fake-model" },
          config: { model: { reasoning: "high" } },
          context: {
            systemPrompt: opened.instructions,
            messages: [
              {
                role: "user",
                content: [{ type: "text", text: "clean up" }],
                timestamp: Date.now()
              }
            ],
            tools: [bashTool],
            sourceTools: [bashTool]
          }
        }
      },
      () => undefined
    );

    expect(executions).toBe(0);
    const persisted = await manager.readThread(opened.id, threadId);
    const assistant = persisted.thread.context?.messages?.[1];
    expect(
      assistant?.role === "assistant"
        ? assistant.toolCalls?.[0]?.output
        : undefined
    ).toBeUndefined();
  });

  test("persists an MCP-declared error as a failed tool result", async () => {
    const toolName = "mcp__server__fail";
    const { models, manager, opened, threadId } = await _fixture({
      instructions: "Use MCP.\n",
      toolCall: { name: toolName, arguments: {} }
    });
    let toolResultIsError: boolean | undefined;
    const controller = new StreamThreadController(
      _modelManager(models),
      { capture: () => undefined } as never,
      manager,
      {
        callTool: async () =>
          Promise.resolve({ contentText: "MCP failed", isError: true })
      } as never
    );
    const mcpTool: McpTool = {
      type: "mcp",
      name: toolName,
      description: "Return an MCP error.",
      parameters: { type: "object", properties: {} },
      serverId: "server-id",
      serverName: "server",
      toolName: "fail"
    };

    await controller.run(
      {
        streamId: "stream-mcp-error",
        runtime: {
          type: "agentProject",
          projectId: opened.id,
          threadId,
          executionMode: "react",
          modelSource: "agent"
        },
        request: {
          model: { provider: "fake", id: "fake-model" },
          config: { model: { reasoning: "high" } },
          context: {
            systemPrompt: opened.instructions,
            messages: [
              {
                role: "user",
                content: [{ type: "text", text: "call MCP" }],
                timestamp: Date.now()
              }
            ],
            tools: [mcpTool],
            sourceTools: [mcpTool]
          }
        }
      },
      message => {
        if (
          message.type === "event"
          && message.event.type === "tool_execution_end"
        ) {
          toolResultIsError = message.event.isError;
        }
      }
    );

    expect(toolResultIsError).toBe(true);
    const persisted = await manager.readThread(opened.id, threadId);
    const assistant = persisted.thread.context?.messages?.[1];
    expect(
      assistant?.role === "assistant"
        ? assistant.toolCalls?.[0]?.output?.isError
        : undefined
    ).toBe(true);
  });
});

async function _fixture({
  instructions,
  toolCall,
  projectTool = false
}: {
  instructions: string;
  projectTool?: boolean;
  toolCall?: { arguments: Record<string, unknown>; name: string; };
}) {
  const root = await mkdtemp(path.join(tmpdir(), "llm-space-stream-runtime-"));
  roots.push(root);
  const home = path.join(root, "home");
  const workspace = path.join(home, "workspace");
  const project = path.join(root, "project");
  const agent = path.join(project, "agent");
  await mkdir(projectTool ? path.join(agent, "tools") : agent, {
    recursive: true
  });
  await mkdir(workspace, { recursive: true });
  await writeFile(
    path.join(project, "llm-space.json"),
    JSON.stringify({ schemaVersion: 1, agent: "./agent" })
  );
  await writeFile(
    path.join(agent, "agent.ts"),
    `export default { model: "fake/fake-model", reasoning: "high" };`
  );
  await writeFile(path.join(agent, "instructions.md"), instructions);
  if (projectTool) {
    await writeFile(
      path.join(agent, "tools", "echo.ts"),
      `import { defineTool } from "@llm-space/runtime/tools";
      import { Type } from "typebox";
      export default defineTool({
        description: "Echo text.",
        inputSchema: Type.Object({ text: Type.String() }),
        execute({ text }) { return text; }
      });`
    );
  }
  const models = _models(toolCall);
  const manager = new ExternalAgentProjectManager({
    homePath: home,
    workspaceRoot: workspace,
    getModels: async () => Promise.resolve(models)
  });
  managers.push(manager);
  const opened = await manager.trustAndOpen(project);
  return { models, manager, opened, threadId: opened.threads[0].id };
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

function _models(
  toolCall: { arguments: Record<string, unknown>; name: string; } = {
    name: "echo",
    arguments: { text: "hello" }
  }
) {
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
    stream: (_model: Model<Api>, context: Context) =>
      _stream(context, toolCall),
    streamSimple: (_model: Model<Api>, context: Context) =>
      _stream(context, toolCall)
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

function _stream(
  context: Context,
  toolCall: { arguments: Record<string, unknown>; name: string; }
) {
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
          name: toolCall.name,
          arguments: toolCall.arguments
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
    stopReason: hasResult ? "stop" : "toolUse",
    timestamp: Date.now()
  };
  queueMicrotask(() => {
    stream.push({ type: "start", partial: message });
    stream.push({
      type: "done",
      reason: hasResult ? "stop" : "toolUse",
      message
    });
  });
  return stream;
}
