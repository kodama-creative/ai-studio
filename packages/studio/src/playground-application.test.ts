import { describe, expect, test } from "bun:test";

import {
  createAgentEngine,
  type AgentSnapshot,
  InMemoryEngineStore,
  type RunExecutor,
} from "@llm-space/engine";

import { createPlaygroundApplication } from "./playground-application";
import { InMemoryStudioStore } from "./storage";
import { createSqliteStudioStore } from "./storage/sqlite";

describe.each([
  ["memory", () => new InMemoryStudioStore()],
  ["sqlite", () => createSqliteStudioStore({ path: ":memory:" })],
] as const)("PlaygroundApplication with %s storage", (_name, createStore) => {
  test("persists AgentSpec separately and executes messages through Engine", async () => {
    const store = createStore();
    const engine = _engine();
    const app = createPlaygroundApplication({ engine, store });
    try {
      const created = await app.createPlayground({
        title: "General Agent",
        agentSpec: {
          schemaVersion: 1,
          model: { provider: "test", id: "local" },
          instructions: ["Answer concisely."],
          tools: [],
        },
      });
      const headBeforeDraft = created.headCheckpointId;
      await app.savePlayground(created.id, {
        title: "General Agent",
        agentSpec: created.agentSpec,
        conversation: {
          messages: [
            {
              id: "user-1",
              role: "user",
              content: [{ type: "text", text: "hello" }],
            },
          ],
          state: { debug: true },
        },
      });
      expect((await app.loadPlayground(created.id))?.headCheckpointId).toBe(
        headBeforeDraft
      );

      const receipt = await app.run(created.id, {
        fromMessageId: "user-1",
      });
      const completed = await _waitForTerminal(engine, receipt.runId);
      expect(completed.status).toBe("completed");

      const loaded = await app.loadPlayground(created.id);
      expect(loaded).toMatchObject({
        title: "General Agent",
        agentSpec: {
          model: { provider: "test", id: "local" },
          instructions: ["Answer concisely."],
        },
      });
      const checkpoint = await engine.getCheckpoint(loaded!.headCheckpointId);
      expect(checkpoint?.threadState).toMatchObject({
        state: { debug: true },
        messages: [
          { id: "user-1", role: "user" },
          {
            role: "assistant",
            content: [{ type: "text", text: "Playground answer" }],
          },
        ],
      });
      expect(store.transaction((tx) => tx.getPlayground(created.id))).not.toHaveProperty(
        "messages"
      );
      expect(loaded?.conversation.messages).toHaveLength(2);
    } finally {
      await app.close();
    }
  });
});

test("rejects Playground tool kinds without an Engine v1 execution path", async () => {
  const store = new InMemoryStudioStore();
  const engine = _engine();
  const app = createPlaygroundApplication({ engine, store });
  try {
    const created = await app.createPlayground({
      agentSpec: {
        schemaVersion: 1,
        model: { provider: "test", id: "local" },
        instructions: [],
        tools: [
          {
            type: "provider-hosted",
            config: { type: "web_search" },
          },
          {
            type: "plugin",
            pluginId: "plugin-search",
            toolId: "search",
            name: "plugin_search",
            description: "Search through a Plugin",
            parameters: { type: "object" },
          },
        ],
      },
      conversation: {
        messages: [
          {
            id: "user-native",
            role: "user",
            content: [{ type: "text", text: "Search" }],
          },
        ],
        state: {},
      },
    });

    expect(
      app.run(created.id, { fromMessageId: "user-native" })
    ).rejects.toThrow(
      'Playground "' +
        created.id +
        '" uses tools that Engine v1 cannot execute: web_search, plugin_search.'
    );
  } finally {
    await app.close();
  }
});

test("rejects non-JSON built-in config before creating a durable Run", async () => {
  const store = new InMemoryStudioStore();
  const engine = _engine();
  const app = createPlaygroundApplication({ engine, store });
  try {
    const created = await app.createPlayground({
      agentSpec: {
        schemaVersion: 1,
        model: { provider: "test", id: "local" },
        instructions: [],
        tools: [
          {
            type: "builtin",
            name: "broken_config",
            description: "Has a non-serializable config",
            parameters: { type: "object" },
            config: { version: 1n },
          },
        ],
      },
      conversation: {
        messages: [
          {
            id: "user-config",
            role: "user",
            content: [{ type: "text", text: "Run" }],
          },
        ],
        state: {},
      },
    });

    expect(
      app.run(created.id, { fromMessageId: "user-config" })
    ).rejects.toThrow('Built-in tool "broken_config" config must be a JSON object.');
  } finally {
    await app.close();
  }
});

function _engine() {
  const executor: RunExecutor = {
    async executeStep(input, sink) {
      const message = {
        id: input.createMessageId(),
        role: "assistant" as const,
        content: [{ type: "text" as const, text: "Playground answer" }],
      };
      await sink.accept({
        type: "assistant.delta",
        message,
        textDelta: "Playground answer",
      });
      await sink.accept({ type: "assistant.completed", message });
    },
  };
  return createAgentEngine({
    store: new InMemoryEngineStore(),
    runExecutor: executor,
    agentResolver: {
      resolve(snapshot: AgentSnapshot) {
        return Promise.resolve({ snapshot, tools: new Map() });
      },
    },
    createToolContext: ({ execution, signal }) => ({
      execution,
      abortSignal: signal,
      getSandbox() {
        throw new Error("No sandbox in Playground tests.");
      },
      getSkill() {
        throw new Error("No skills in Playground tests.");
      },
      getToken() {
        return Promise.reject(new Error("No auth in Playground tests."));
      },
      requireAuth() {
        throw new Error("No auth in Playground tests.");
      },
    }),
  });
}

async function _waitForTerminal(
  engine: ReturnType<typeof createAgentEngine>,
  runId: string
) {
  for await (const frame of engine.streamRun(runId, { follow: true })) {
    const run = frame.type === "snapshot" ? frame.run : undefined;
    if (
      run !== undefined &&
      ["completed", "failed", "cancelled", "interrupted"].includes(run.status)
    ) {
      return run;
    }
    if (frame.type === "event" && frame.event.type === "run.updated") {
      if (
        ["completed", "failed", "cancelled", "interrupted"].includes(
          frame.event.run.status
        )
      ) {
        return frame.event.run;
      }
    }
  }
  throw new Error("Run stream ended before terminal state.");
}
