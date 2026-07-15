import { mkdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "bun:test";
import type { ProjectTool } from "@llm-space/core";
import type { ProjectMcpConnector } from "@llm-space/runtime/node";

import { ExternalAgentProjectManager } from "./external-agent-project-manager";

const roots: string[] = [];
const managers: ExternalAgentProjectManager[] = [];

afterEach(async () => {
  await Promise.all(managers.splice(0).map((manager) => manager.shutdown()));
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true }))
  );
});

async function _fixture(options: { connector?: ProjectMcpConnector } = {}) {
  const root = path.join(tmpdir(), `llm-space-external-${crypto.randomUUID()}`);
  const home = path.join(root, "home");
  const workspace = path.join(home, "workspace");
  const project = path.join(root, "repo");
  const marker = path.join(root, "tool-loaded.txt");
  roots.push(root);
  await mkdir(path.join(project, "agent", "tools"), { recursive: true });
  await writeFile(
    path.join(project, "llm-space.json"),
    JSON.stringify({ schemaVersion: 1, agent: "./agent" }),
    "utf8"
  );
  await writeFile(
    path.join(project, "agent", "agent.ts"),
    `export default { model: "openai/gpt-5.3-codex", reasoning: "high" };`,
    "utf8"
  );
  await writeFile(
    path.join(project, "agent", "instructions.md"),
    "Use echo for every request.\n",
    "utf8"
  );
  await writeFile(
    path.join(project, "agent", "tools", "echo.ts"),
    `import { writeFileSync } from "node:fs";
import { defineTool } from "@llm-space/runtime/tools";
import { Type } from "typebox";
writeFileSync(${JSON.stringify(marker)}, "loaded");
export default defineTool({
  description: "Echo text",
  inputSchema: Type.Object({ text: Type.String() }),
  execute({ text }) { return { text }; }
});
`,
    "utf8"
  );
  await mkdir(workspace, { recursive: true });
  const manager = new ExternalAgentProjectManager({
    homePath: home,
    workspaceRoot: workspace,
    projectMcpConnector: options.connector,
  });
  managers.push(manager);
  return { home, manager, marker, project, workspace };
}

describe("ExternalAgentProjectManager", () => {
  test("does not import tools before trust, then creates desktop-owned Threads", async () => {
    const { home, manager, marker, project } = await _fixture();
    const preview = await manager.preview(project);
    expect(preview.trusted).toBe(false);
    expect(await Bun.file(marker).exists()).toBe(false);

    const opened = await manager.trustAndOpen(project);
    expect(opened.status).toBe("ready");
    expect(await Bun.file(marker).exists()).toBe(true);
    expect(opened.threads).toHaveLength(1);

    const threadId = opened.threads[0].id;
    const record = await manager.readThread(opened.id, threadId);
    expect(record.thread.model).toEqual({
      provider: "openai",
      id: "gpt-5.3-codex",
      params: { reasoning: "high" },
    });
    expect(record.thread.agentRuntime).toMatchObject({
      projectId: opened.id,
      snapshot: opened.snapshot,
      definitionFingerprint: opened.definitionFingerprint,
      modelSource: "agent",
    });
    expect(record.thread.context?.systemPrompt).toContain("Use echo");
    expect(record.thread.context?.tools?.[0]?.type).toBe("project");

    const tool = opened.tools[0];
    expect(
      await manager.callTool({
        projectId: opened.id,
        snapshot: tool.snapshot,
        name: tool.name,
        arguments: { text: "hello" },
      })
    ).toEqual({ contentText: '{"text":"hello"}', isError: false });

    for (let index = 0; index < 12; index += 1) {
      await writeFile(
        path.join(project, "agent", "instructions.md"),
        `Project prompt ${index}.\n`,
        "utf8"
      );
      await manager.refresh(opened.id);
    }
    expect(
      await manager.callTool({
        projectId: opened.id,
        snapshot: tool.snapshot,
        name: tool.name,
        arguments: { text: "frozen" },
      })
    ).toEqual({ contentText: '{"text":"frozen"}', isError: false });

    expect(await Bun.file(path.join(project, ".llm-space")).exists()).toBe(
      false
    );
    expect(
      await Bun.file(
        path.join(home, "projects", opened.id, "threads", `${threadId}.json`)
      ).exists()
    ).toBe(true);
  });

  test("marks prompt copies out of sync until explicit sync", async () => {
    const { manager, project } = await _fixture();
    const opened = await manager.trustAndOpen(project);
    const threadId = opened.threads[0].id;
    const before = await manager.readThread(opened.id, threadId);
    expect(before.syncedPrompt).toBe("Use echo for every request.\n");
    const skills = before.thread.context?.variables?.available_skills;
    if (skills?.type !== "skills") throw new Error("Missing skills variable");
    await manager.writeThread(opened.id, threadId, {
      ...before,
      thread: {
        ...before.thread,
        context: {
          ...before.thread.context,
          variables: {
            ...before.thread.context?.variables,
            available_skills: { ...skills, skillNames: ["missing-skill"] },
          },
        },
      },
    });
    expect(
      (await manager.readThread(opened.id, threadId)).thread.context?.variables
        ?.available_skills
    ).toMatchObject({ skillNames: ["missing-skill"] });

    await writeFile(
      path.join(project, "agent", "instructions.md"),
      "Updated project prompt.\n",
      "utf8"
    );
    await writeFile(
      path.join(project, "agent", "agent.ts"),
      `export default { model: "openai/gpt-5.3", reasoning: "medium" };`,
      "utf8"
    );
    const refreshed = await manager.refresh(opened.id);
    expect(refreshed.promptFingerprint).not.toBe(before.promptFingerprint);
    const outOfSync = await manager.readThread(opened.id, threadId);
    expect(outOfSync.syncedPrompt).toBe(before.syncedPrompt);

    const synced = await manager.syncThreadFromAgent(opened.id, threadId);
    expect(synced.promptFingerprint).toBe(refreshed.promptFingerprint);
    expect(synced.thread.context?.systemPrompt).toBe(
      "Updated project prompt.\n"
    );
    expect(synced.syncedPrompt).toBe("Updated project prompt.\n");
    expect(synced.thread.model).toEqual({
      provider: "openai",
      id: "gpt-5.3",
      params: { reasoning: "medium" },
    });
    expect(synced.definitionFingerprint).toBe(refreshed.definitionFingerprint);
  });

  test("keeps a trusted invalid project open for source diagnostics", async () => {
    const { manager, project } = await _fixture();
    await writeFile(
      path.join(project, "agent", "tools", "echo.ts"),
      "invalid TypeScript source;",
      "utf8"
    );

    const opened = await manager.trustAndOpen(project);

    expect(opened.status).toBe("invalid");
    expect(opened.error).toContain("Unable to import echo.ts");
    expect(opened.threads).toHaveLength(0);
    expect((await manager.list())[0]?.status).toBe("invalid");
  });

  test("restores desktop-owned Threads after restart and reports a missing path", async () => {
    const { home, manager, project } = await _fixture();
    const opened = await manager.trustAndOpen(project);
    const threadId = opened.threads[0].id;
    await manager.shutdown();
    managers.splice(managers.indexOf(manager), 1);

    const restarted = new ExternalAgentProjectManager({
      homePath: home,
      workspaceRoot: path.join(home, "workspace"),
    });
    managers.push(restarted);
    const [restored] = await restarted.list();
    expect(restored.status).toBe("ready");
    expect(restored.threads.map((thread) => thread.id)).toContain(threadId);

    await rm(project, { recursive: true });
    await restarted.refresh(opened.id);
    const [missing] = await restarted.list();
    expect(missing.status).toBe("missing");
    expect(missing.threads.map((thread) => thread.id)).toContain(threadId);
  });

  test("migrates matching legacy model values as an explicit Thread override", async () => {
    const { home, manager, project } = await _fixture();
    const opened = await manager.trustAndOpen(project);
    if (!opened.definition) throw new Error("Missing Agent definition");
    const threadId = opened.threads[0].id;
    const threadFile = path.join(
      home,
      "projects",
      opened.id,
      "threads",
      `${threadId}.json`
    );
    const legacy = (await Bun.file(threadFile).json()) as Record<
      string,
      unknown
    > & { thread: Record<string, unknown> };
    delete legacy.definitionFingerprint;
    delete legacy.syncedDefinition;
    delete legacy.modelSource;
    delete legacy.thread.agentRuntime;
    legacy.thread.model = {
      provider: "openai",
      id: "gpt-5.3-codex",
      params: { reasoning: "high" },
    };
    await writeFile(threadFile, JSON.stringify(legacy), "utf8");

    const migrated = await manager.readThread(opened.id, threadId);

    expect(migrated.thread.model).toEqual({
      provider: "openai",
      id: "gpt-5.3-codex",
      params: { reasoning: "high" },
    });
    expect(migrated.syncedDefinition).toEqual(opened.definition);
    expect(migrated.thread.agentRuntime?.modelSource).toBe("threadOverride");
    expect(
      (await Bun.file(threadFile).json()) as Record<string, unknown>
    ).toMatchObject({
      definitionFingerprint: opened.definitionFingerprint,
      syncedDefinition: opened.definition,
    });
  });

  test("retains a legacy override when the project recovers after migration", async () => {
    const { home, manager, project } = await _fixture();
    const opened = await manager.trustAndOpen(project);
    const threadId = opened.threads[0].id;
    const threadFile = path.join(
      home,
      "projects",
      opened.id,
      "threads",
      `${threadId}.json`
    );
    const legacy = (await Bun.file(threadFile).json()) as Record<
      string,
      unknown
    > & { thread: Record<string, unknown> };
    delete legacy.definitionFingerprint;
    delete legacy.syncedDefinition;
    delete legacy.modelSource;
    delete legacy.thread.agentRuntime;
    await writeFile(threadFile, JSON.stringify(legacy), "utf8");
    await manager.shutdown();
    managers.splice(managers.indexOf(manager), 1);

    const parked = `${project}-parked`;
    await rename(project, parked);
    const restarted = new ExternalAgentProjectManager({
      homePath: home,
      workspaceRoot: path.join(home, "workspace"),
    });
    managers.push(restarted);
    const missing = await restarted.readThread(opened.id, threadId);
    expect(missing.thread.agentRuntime).toBeUndefined();

    await rename(parked, project);
    await restarted.refresh(opened.id);
    const recovered = await restarted.readThread(opened.id, threadId);

    expect(recovered.thread.agentRuntime?.modelSource).toBe("threadOverride");
  });

  test("discovers manifestless workspace Agents without registering them", async () => {
    const { home, manager, workspace } = await _fixture();
    const project = path.join(workspace, "nested", "weather-agent");
    await mkdir(path.join(project, "agent"), { recursive: true });
    await writeFile(
      path.join(project, "agent", "agent.ts"),
      `export default { model: "openai/gpt-5.3-codex", reasoning: "high" };`,
      "utf8"
    );
    await writeFile(
      path.join(project, "agent", "instructions.md"),
      "Be concise.\n",
      "utf8"
    );

    const [discovered] = await manager.list();
    expect(discovered.path).toBe(await realpath(project));
    expect(discovered.removable).toBe(false);
    expect(discovered.status).toBe("ready");
    expect(discovered.threads).toHaveLength(0);

    const opened = await manager.trustAndOpen(project);
    expect(opened.removable).toBe(false);
    expect(opened.threads).toHaveLength(1);
    expect(
      await Bun.file(
        path.join(home, "settings", "external-agent-projects.json")
      ).exists()
    ).toBe(false);
  });

  test("deactivation cancels an in-flight Project MCP call", async () => {
    let resolveStarted!: (signal: AbortSignal) => void;
    const started = new Promise<AbortSignal>((resolve) => {
      resolveStarted = resolve;
    });
    const { manager, project } = await _fixture({
      connector: async () => ({
        async listTools() {
          return [
            {
              name: "forecast",
              description: "Read a forecast",
              inputSchema: { type: "object" },
            },
          ];
        },
        callTool(_name, _input, signal) {
          if (!signal) throw new Error("Missing Project MCP abort signal");
          resolveStarted(signal);
          return new Promise((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(signal.reason), {
              once: true,
            });
          });
        },
        async close() {},
      }),
    });
    await mkdir(path.join(project, "agent", "connections"), {
      recursive: true,
    });
    await writeFile(
      path.join(project, "agent", "connections", "weather.ts"),
      `import { defineMcpClientConnection } from "@llm-space/runtime/connections";
export default defineMcpClientConnection({
  url: "https://weather.example.test/mcp",
  description: "Weather service",
  tools: { allow: ["forecast"] }
});`,
      "utf8"
    );
    const opened = await manager.trustAndOpen(project);
    const threadId = opened.threads[0]!.id;
    await manager.activateConnections(opened.id, threadId);
    const record = await manager.readThread(opened.id, threadId);
    await manager.writeThread(opened.id, threadId, {
      ...record,
      thread: {
        ...record.thread,
        context: {
          ...record.thread.context,
          messages: [
            {
              id: "assistant-one",
              role: "assistant",
              content: [],
              toolCalls: [
                {
                  id: "call-one",
                  input: { name: "weather__forecast", arguments: {} },
                },
              ],
            },
          ],
        },
      },
    });

    const call = manager.callTool({
      projectId: opened.id,
      threadId,
      snapshot: opened.snapshot,
      name: "weather__forecast",
      arguments: {},
      attempt: {
        messageId: "assistant-one",
        toolCallId: "call-one",
        at: "2026-07-15T00:00:00.000Z",
      },
    });
    const signal = await started;
    await manager.deactivateConnections(opened.id, threadId);

    await expect(call).rejects.toThrow("session closed");
    expect(signal.aborted).toBe(true);
  });

  test("activates project MCP per Thread without persisting connection secrets", async () => {
    let schemaVersion = 1;
    let connectionAvailable = true;
    let closeCount = 0;
    const connector: ProjectMcpConnector = async () => ({
      async listTools() {
        if (!connectionAvailable) return [];
        return [
          {
            name: "forecast",
            description: "Read a forecast",
            inputSchema: {
              type: "object",
              properties: { version: { const: schemaVersion } },
            },
          },
        ];
      },
      async callTool() {
        return { contentText: "sunny", isError: false };
      },
      async close() {
        closeCount += 1;
      },
    });
    const { home, manager, project } = await _fixture({ connector });
    const callbackMarker = path.join(path.dirname(home), "auth-resolved.txt");
    await mkdir(path.join(project, "agent", "connections"), {
      recursive: true,
    });
    await writeFile(
      path.join(project, "agent", "connections", "weather.ts"),
      `import { writeFileSync } from "node:fs";
import { defineMcpClientConnection } from "@llm-space/runtime/connections";
export default defineMcpClientConnection({
  url: "https://secret-host.example.test/mcp",
  description: "Weather service",
  auth() {
    writeFileSync(${JSON.stringify(callbackMarker)}, "resolved");
    return { token: "secret-token" };
  },
  tools: { allow: ["forecast"] }
});`,
      "utf8"
    );

    const opened = await manager.trustAndOpen(project);
    expect(await Bun.file(callbackMarker).exists()).toBe(false);
    const threadId = opened.threads[0]!.id;
    const activation = await manager.activateConnections(opened.id, threadId);

    expect(await Bun.file(callbackMarker).exists()).toBe(true);
    expect(activation.hasSchemaDrift).toBe(false);
    expect(activation.tools.map((tool) => tool.name)).toEqual([
      "weather__forecast",
    ]);
    const record = await manager.readThread(opened.id, threadId);
    expect(record.thread.context?.tools?.map((tool) => tool.name)).toContain(
      "weather__forecast"
    );
    const callRecord = {
      ...record,
      thread: {
        ...record.thread,
        context: {
          ...record.thread.context,
          messages: [
            {
              id: "assistant-one",
              role: "assistant" as const,
              content: [],
              toolCalls: [
                {
                  id: "call-one",
                  input: { name: "weather__forecast", arguments: {} },
                },
              ],
            },
          ],
        },
      },
    };
    await manager.writeThread(opened.id, threadId, callRecord);
    expect(
      await manager.callTool({
        projectId: opened.id,
        threadId,
        snapshot: opened.snapshot,
        name: "weather__forecast",
        arguments: {},
        attempt: {
          messageId: "assistant-one",
          toolCallId: "call-one",
          at: "2026-07-15T00:00:00.000Z",
        },
      })
    ).toEqual({ contentText: "sunny", isError: false });
    const attempted = await manager.readThread(opened.id, threadId);
    const attemptedMessage = attempted.thread.context?.messages?.find(
      (message) => message.role === "assistant"
    );
    expect(
      attemptedMessage?.role === "assistant"
        ? attemptedMessage.toolCalls?.[0]?.attempt
        : undefined
    ).toEqual({ status: "started", at: "2026-07-15T00:00:00.000Z" });

    const oldFingerprint = record.thread.context?.tools?.find(
      (tool): tool is ProjectTool =>
        tool.type === "project" && tool.name === "weather__forecast"
    )?.schemaFingerprint;
    schemaVersion = 2;
    const drifted = await manager.activateConnections(opened.id, threadId);
    expect(drifted.hasSchemaDrift).toBe(true);
    expect(drifted.statuses[0]?.state).toBe("drift");
    await expect(
      manager.callTool({
        projectId: opened.id,
        threadId,
        snapshot: opened.snapshot,
        name: "weather__forecast",
        arguments: { version: 2 },
        attempt: {
          messageId: "assistant-one",
          toolCallId: "call-one",
          at: "2026-07-15T00:01:00.000Z",
        },
      })
    ).rejects.toThrow("Sync from Agent");
    expect(
      (await manager.readThread(opened.id, threadId)).thread.context?.tools?.find(
        (tool): tool is ProjectTool =>
          tool.type === "project" && tool.name === "weather__forecast"
      )?.schemaFingerprint
    ).toBe(oldFingerprint);

    const synced = await manager.syncThreadFromAgent(opened.id, threadId);
    expect(
      synced.thread.context?.tools?.find(
        (tool): tool is ProjectTool =>
          tool.type === "project" && tool.name === "weather__forecast"
      )?.schemaFingerprint
    ).not.toBe(oldFingerprint);

    connectionAvailable = false;
    const unavailable = await manager.activateConnections(opened.id, threadId);
    expect(unavailable.statuses[0]?.state).toBe("unavailable");
    expect(
      manager.getActiveRemoteToolNames(opened.id, threadId, opened.snapshot)
    ).toEqual(new Set());
    connectionAvailable = true;

    await rm(path.join(project, "agent", "connections", "weather.ts"));
    await manager.refresh(opened.id);
    const removed = await manager.activateConnections(opened.id, threadId);
    expect(removed.hasSchemaDrift).toBe(true);
    expect(removed.statuses).toEqual([
      expect.objectContaining({ connectionName: "weather", state: "drift" }),
    ]);
    expect(
      (await manager.readThread(opened.id, threadId)).thread.context?.tools?.map(
        (tool) => tool.name
      )
    ).toContain("weather__forecast");
    expect(
      (
        await manager.syncThreadFromAgent(opened.id, threadId)
      ).thread.context?.tools?.map((tool) => tool.name)
    ).not.toContain("weather__forecast");

    const persisted = await Bun.file(
      path.join(home, "projects", opened.id, "threads", `${threadId}.json`)
    ).text();
    expect(persisted).not.toContain("secret-host");
    expect(persisted).not.toContain("secret-token");
    await manager.deactivateConnections(opened.id, threadId);
    expect(closeCount).toBe(3);
  });
});
