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
      mode: "step",
    });
    await _waitForRunStatus(host, receipt.operationId, "paused");
    await host.close();

    // Resolver inputs come from the SQLite Run snapshot after restart, not the
    // mutable renderer document or an in-memory tool registry cache.
    host = createHost();
    await host.continueRun(receipt.operationId);
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

test("rejects ACP prompt content that differs from the saved Playground Draft", async () => {
  const homePath = await mkdtemp(
    path.join(tmpdir(), "llm-space-playground-prompt-")
  );
  const faux = fauxProvider({ tokensPerSecond: 0 });
  const model = faux.getModel();
  const models = createModels();
  models.setProvider(faux.provider);
  const host = createPlaygroundHost({
    homePath,
    models,
    runtime: _emptyRuntime(),
  });
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
            id: "user-saved",
            role: "user",
            content: [{ type: "text", text: "Saved prompt" }],
          },
        ],
        state: {},
      },
    });

    expect(
      host.acpBackend.prompt({
        sessionId: playground.sessionId,
        messages: [
          { role: "user", content: "Different prompt", timestamp: 1 },
        ],
        meta: {
          "llm-space.dev": {
            fromMessageId: "user-saved",
            mode: "continue",
          },
        },
        signal: new AbortController().signal,
      })
    ).rejects.toThrow(
      'ACP prompt content does not match Studio user Message "user-saved".'
    );
    expect((await host.loadPlayground(playground.id))?.dirty).toBeTrue();
  } finally {
    await host.close();
    await rm(homePath, { recursive: true, force: true });
  }
});

test("reconstructs a durable ACP Step receipt after Playground host restart", async () => {
  const homePath = await mkdtemp(
    path.join(tmpdir(), "llm-space-playground-receipt-")
  );
  const faux = fauxProvider({ tokensPerSecond: 0 });
  const model = faux.getModel();
  const models = createModels();
  models.setProvider(faux.provider);
  faux.setResponses([fauxAssistantMessage("Committed once.")]);
  const createHost = () =>
    createPlaygroundHost({
      homePath,
      models,
      runtime: _emptyRuntime(),
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
    await host.run(playground.id, { fromMessageId: "user-receipt" });
    const admitted = await host.acpBackend.inspect({
      sessionId: playground.sessionId,
    });
    const action = admitted.snapshot.nextAction;
    expect(action?.kind).toBe("model");
    const command = {
      sessionId: playground.sessionId,
      commandId: "step-after-restart",
      expectedActionId: action!.id,
      kind: "model" as const,
    };
    const committed = await host.acpBackend.step(command);
    expect(committed.status).toBe("completed");
    await host.close();

    host = createHost();
    const reconstructed = await host.acpBackend.step(command);
    expect(reconstructed).toMatchObject({
      status: "completed",
      leafId: committed.leafId,
      messageEntries: [{ message: { role: "user" } }, { message: { role: "assistant" } }],
    });
    expect(
      host.acpBackend.step({
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

/** Supplies a host runtime for tests that do not execute tools. */
function _emptyRuntime(): RuntimeClient {
  return {
    builtInListTools: () => [],
    mcpListTools: () => Promise.reject(new Error("Unexpected MCP lookup.")),
  } as unknown as RuntimeClient;
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
  host: ReturnType<typeof createPlaygroundHost>,
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
  host: ReturnType<typeof createPlaygroundHost>,
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
