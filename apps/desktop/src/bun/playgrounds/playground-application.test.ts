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

import {
  createDesktopPlaygroundApplication,
  type PlaygroundToolHost,
} from "./playground-application";

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
  const tools: PlaygroundToolHost = {
    listBuiltinTools: () => [],
    callBuiltinTool: () =>
      Promise.reject(new Error("Unexpected built-in tool call.")),
    listMcpTools(serverId: string) {
      listedServers.push(serverId);
      return Promise.resolve(_mcpToolsResponse(tool));
    },
    callMcpTool(input: Parameters<PlaygroundToolHost["callMcpTool"]>[0]) {
      calls.push(input);
      return Promise.resolve({
        content: [{ type: "text" as const, text: "Weather service failed" }],
        isError: true,
      });
    },
  };
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
    createDesktopPlaygroundApplication({
      homePath,
      tools,
      models,
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
      commandId: "initial-step-weather",
      mode: "step",
    });
    await _waitForRunStatus(host, receipt.operationId, "paused");
    await host.close();

    // Resolver inputs come from the SQLite Run snapshot after restart, not the
    // mutable renderer document or an in-memory tool registry cache.
    host = createHost();
    await host.continueRun(playground.id, receipt.operationId, {
      commandId: "continue-weather-after-restart",
    });
    await _waitForTerminalRun(host, receipt.operationId);
    const loaded = await host.loadPlayground(playground.id);
    const assistant = loaded?.conversation.messages.find(
      (message) => message.role === "assistant" && message.toolCalls?.length
    );

    expect(listedServers.length).toBeGreaterThanOrEqual(2);
    expect(new Set(listedServers)).toEqual(new Set(["server-weather"]));
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

test("reconstructs a durable Step receipt after Playground host restart", async () => {
  const homePath = await mkdtemp(
    path.join(tmpdir(), "llm-space-playground-receipt-")
  );
  const faux = fauxProvider({ tokensPerSecond: 0 });
  const model = faux.getModel();
  const models = createModels();
  models.setProvider(faux.provider);
  faux.setResponses([fauxAssistantMessage("Committed once.")]);
  const createHost = () =>
    createDesktopPlaygroundApplication({
      homePath,
      models,
      tools: _emptyTools(),
    });
  let host = createHost();
  try {
    const playground = await host.createPlayground({
      agentSpec: {
        schemaVersion: 1,
        model: { provider: model.provider, id: model.id },
        instructions: [],
        tools: [],
      },
      conversation: {
        messages: [
          {
            id: "user-receipt",
            role: "user",
            content: [{ type: "text", text: "Run once" }],
          },
        ],
        state: {},
      },
    });
    const run = await host.run(playground.id, {
      fromMessageId: "user-receipt",
      commandId: "run-before-restart",
    });
    const admitted = await host.inspectRun(playground.id, run.operationId);
    const action = admitted.nextAction;
    expect(action?.kind).toBe("model");
    const command = {
      commandId: "step-after-restart",
      expectedActionId: action!.id,
      kind: "model" as const,
    };
    const committed = await host.stepRun(playground.id, run.operationId, command);
    expect(committed).toEqual(run);
    expect((await host.inspectRun(playground.id, run.operationId)).status).toBe(
      "completed"
    );
    await host.close();

    host = createHost();
    const reconstructed = await host.stepRun(
      playground.id,
      run.operationId,
      command
    );
    expect(reconstructed).toEqual(run);
    expect(await host.inspectRun(playground.id, run.operationId)).toMatchObject({
      status: "completed",
      messageEntries: [
        { message: { role: "user" } },
        { message: { role: "assistant" } },
      ],
    });
    expect(
      host.stepRun(playground.id, run.operationId, {
        ...command,
        expectedActionId: "other-action",
      })
    ).rejects.toThrow(
      'Command "step-after-restart" was already used with other input.'
    );
  } finally {
    await host.close();
    await rm(homePath, { recursive: true, force: true });
  }
});

/** Supplies a host tool seam for tests that do not execute tools. */
function _emptyTools(): PlaygroundToolHost {
  return {
    listBuiltinTools: () => [],
    callBuiltinTool: () =>
      Promise.reject(new Error("Unexpected built-in tool call.")),
    listMcpTools: () => Promise.reject(new Error("Unexpected MCP lookup.")),
    callMcpTool: () => Promise.reject(new Error("Unexpected MCP tool call.")),
  };
}

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
  host: ReturnType<typeof createDesktopPlaygroundApplication>,
  operationId: string
): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const run = await host.getRun(operationId);
    if (
      run?.status === "completed" ||
      run?.status === "failed" ||
      run?.status === "aborted" ||
      run?.status === "declined"
    ) {
      expect(run.status).toBe("completed");
      return;
    }
    await Bun.sleep(5);
  }
  throw new Error(`Operation "${operationId}" did not reach a terminal state.`);
}

async function _waitForRunStatus(
  host: ReturnType<typeof createDesktopPlaygroundApplication>,
  operationId: string,
  status: "paused"
): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const run = await host.getRun(operationId);
    if (run?.status === status) return;
    if (
      run?.status === "completed" ||
      run?.status === "failed" ||
      run?.status === "aborted" ||
      run?.status === "declined"
    ) {
      throw new Error(
        `Operation "${operationId}" reached "${run.status}" before "${status}".`
      );
    }
    await Bun.sleep(5);
  }
  throw new Error(`Operation "${operationId}" did not reach "${status}".`);
}
