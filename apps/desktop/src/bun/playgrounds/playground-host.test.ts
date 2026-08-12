import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import type { McpServerToolsResponse, McpTool } from "@llm-space/core";
import { createPiRunExecutor } from "@llm-space/engine-pi";
import type { RuntimeClient } from "@llm-space/runtime/runtime";

import { createPlaygroundHost } from "./playground-host";

test("resolves and executes only the MCP tools frozen into a Playground Run", async () => {
  const homePath = await mkdtemp(
    path.join(tmpdir(), "llm-space-playground-host-")
  );
  const faux = fauxProvider({ tokensPerSecond: 0 });
  const model = faux.getModel();
  const tool: McpTool = {
    type: "mcp",
    name: "mcp__weather__forecast",
    description: "Get the forecast",
    parameters: {
      type: "object",
      properties: { city: { type: "string" } },
      required: ["city"],
    },
    serverId: "server-weather",
    serverName: "weather",
    toolName: "forecast",
  };
  const listedServers: string[] = [];
  const calls: unknown[] = [];
  const runtime = {
    builtInListTools: () => [],
    mcpListTools(serverId: string) {
      listedServers.push(serverId);
      return Promise.resolve(_mcpToolsResponse(tool));
    },
    mcpCallTool(input: unknown) {
      calls.push(input);
      return Promise.resolve({
        content: [{ type: "text" as const, text: "Weather service failed" }],
        isError: true,
      });
    },
  } as unknown as RuntimeClient;
  const models = createModels();
  models.setProvider(faux.provider);
  faux.setResponses([
    fauxAssistantMessage(
      [fauxToolCall(tool.name, { city: "Shanghai" }, { id: "call-mcp" })],
      { stopReason: "toolUse" }
    ),
    fauxAssistantMessage("The weather service is unavailable."),
  ]);
  const createHost = () =>
    createPlaygroundHost({
      homePath,
      runtime,
      runExecutor: createPiRunExecutor({ models }),
    });
  let host = createHost();

  try {
    const playground = await host.createPlayground({
      agentSpec: {
        schemaVersion: 1,
        model: { provider: model.provider, id: model.id },
        instructions: [],
        tools: [tool],
      },
    });
    await host.savePlayground(playground.id, {
      title: playground.title,
      agentSpec: playground.agentSpec,
      conversation: {
        messages: [
          {
            id: "user-weather",
            role: "user",
            content: [{ type: "text", text: "What is the weather?" }],
          },
        ],
        state: {},
      },
    });

    const receipt = await host.run(playground.id, {
      fromMessageId: "user-weather",
      mode: "step",
    });
    await _waitForRunStatus(host, receipt.runId, "paused");
    await host.close();

    // Resolver inputs come from the SQLite Run snapshot after restart, not the
    // mutable renderer document or an in-memory tool registry cache.
    host = createHost();
    await host.continueRun(receipt.runId);
    await _waitForTerminalRun(host, receipt.runId);
    const loaded = await host.loadPlayground(playground.id);
    const assistant = loaded?.conversation.messages.find(
      (message) => message.role === "assistant" && message.toolCalls?.length
    );

    expect(listedServers).toEqual([
      "server-weather",
      "server-weather",
    ]);
    expect(calls).toEqual([
      {
        serverId: "server-weather",
        toolName: "forecast",
        arguments: { city: "Shanghai" },
      },
    ]);
    expect(assistant).toMatchObject({
      toolCalls: [
        {
          id: "call-mcp",
          output: {
            content: [{ type: "text", text: "Weather service failed" }],
            isError: true,
          },
        },
      ],
    });
  } finally {
    await host.close();
    await rm(homePath, { recursive: true, force: true });
  }
});

function _mcpToolsResponse(tool: McpTool): McpServerToolsResponse {
  return {
    server: {
      id: tool.serverId,
      name: "Weather",
      serverName: tool.serverName,
      transport: "stdio",
      command: "weather-server",
      createdAt: 1,
      updatedAt: 1,
      connected: true,
      toolCount: 1,
    },
    tools: [
      {
        serverId: tool.serverId,
        serverName: tool.serverName,
        serverDisplayName: "Weather",
        toolName: tool.toolName,
        normalizedToolName: tool.toolName,
        directName: tool.name,
        description: tool.description,
        inputSchema: tool.parameters,
        requiredFields: ["city"],
        topLevelProperties: ["city"],
        available: true,
      },
    ],
  };
}

async function _waitForTerminalRun(
  host: ReturnType<typeof createPlaygroundHost>,
  runId: string
): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const run = await host.getRun(runId);
    if (
      run?.status === "completed" ||
      run?.status === "failed" ||
      run?.status === "cancelled" ||
      run?.status === "interrupted"
    ) {
      expect(run.status).toBe("completed");
      return;
    }
    await Bun.sleep(5);
  }
  throw new Error(`Run "${runId}" did not reach a terminal state.`);
}

async function _waitForRunStatus(
  host: ReturnType<typeof createPlaygroundHost>,
  runId: string,
  status: "paused"
): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const run = await host.getRun(runId);
    if (run?.status === status) return;
    if (
      run?.status === "completed" ||
      run?.status === "failed" ||
      run?.status === "cancelled" ||
      run?.status === "interrupted"
    ) {
      throw new Error(
        `Run "${runId}" reached "${run.status}" before "${status}".`
      );
    }
    await Bun.sleep(5);
  }
  throw new Error(`Run "${runId}" did not reach "${status}".`);
}
