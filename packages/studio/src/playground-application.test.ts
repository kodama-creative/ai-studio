import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
  BunSqliteRuntimeBindingStore,
  BunSqliteSessionRepository,
  DurablePiRuntime,
  type AssistantExecutor,
} from "@llm-space/pi-runtime";

import { createPlaygroundApplication } from "./playground-application";
import { InMemoryStudioStore, type StudioStore } from "./storage";
import { createSqliteStudioStore } from "./storage/sqlite";

const ASSISTANT: AssistantMessage = {
  role: "assistant",
  content: [{ type: "text", text: "Playground answer" }],
  api: "openai-responses",
  provider: "test",
  model: "local",
  usage: {
    input: 1,
    output: 1,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 2,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    },
  },
  stopReason: "stop",
  timestamp: 2,
};

describe.each(["memory", "sqlite"] as const)(
  "PlaygroundApplication with %s Studio storage",
  (storageKind) => {
    test("persists only Studio metadata while Pi owns transcript and operation state", async () => {
      const fixture = await _fixture(storageKind);
      try {
        const created = await fixture.app.createPlayground({
          title: "General Agent",
          agentSpec: {
            schemaVersion: 1,
            model: { provider: "test", id: "local" },
            instructions: ["Answer concisely."],
            tools: [],
          },
        });
        expect(typeof created.sessionId).toBe("string");
        expect(created).toMatchObject({
          lane: "main",
          leafId: null,
          runtimeFormatVersion: 1,
        });

        await fixture.app.savePlayground(created.id, {
          title: created.title,
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
        expect(
          (await fixture.app.loadPlayground(created.id))?.leafId
        ).toBeNull();

        const receipt = await fixture.app.run(created.id, {
          fromMessageId: "user-1",
        });
        const paused = await fixture.runtime.open({
          sessionId: receipt.sessionId,
        });
        expect(paused.nextAction?.kind).toBe("model");
        await fixture.app.stepRun(created.id, receipt.operationId, {
          commandId: "step-1",
          expectedActionId: paused.nextAction!.id,
          kind: "model",
        });

        const loaded = await fixture.app.loadPlayground(created.id);
        expect(typeof loaded?.conversation.messages[0]?.id).toBe("string");
        expect(typeof loaded?.conversation.messages[1]?.id).toBe("string");
        expect(loaded).toMatchObject({
          title: "General Agent",
          sessionId: receipt.sessionId,
          agentSpec: {
            model: { provider: "test", id: "local" },
            instructions: ["Answer concisely."],
          },
          conversation: {
            messages: [
              { role: "user" },
              {
                role: "assistant",
                content: [{ type: "text", text: "Playground answer" }],
              },
            ],
          },
        });
        expect(loaded).not.toHaveProperty("operationId");
        expect(
          fixture.store.transaction((tx) => tx.getPlayground(created.id))
        ).toMatchObject({
          sessionId: receipt.sessionId,
          operationReferences: [
            {
              operationId: receipt.operationId,
              leafId: loaded?.leafId,
              relation: "executed",
            },
          ],
        });
        expect(
          fixture.store.transaction((tx) => tx.getPlayground(created.id))
        ).not.toHaveProperty("draft");
        expect(await fixture.app.listRuns(created.id)).toMatchObject([
          { operationId: receipt.operationId, status: "completed" },
        ]);
      } finally {
        await fixture.close();
      }
    });
  }
);

test("rejects Playground tool kinds without a Pi runtime execution path", async () => {
  const fixture = await _fixture("memory");
  try {
    const created = await fixture.app.createPlayground({
      agentSpec: {
        schemaVersion: 1,
        model: { provider: "test", id: "local" },
        instructions: [],
        tools: [
          { type: "provider-hosted", config: { type: "web_search" } },
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
      fixture.app.run(created.id, { fromMessageId: "user-native" })
    ).rejects.toThrow(
      `Playground "${created.id}" uses tools that the Pi runtime cannot execute: web_search.`
    );
  } finally {
    await fixture.close();
  }
});

test("rejects non-JSON built-in config before admitting a Pi operation", async () => {
  const fixture = await _fixture("memory");
  try {
    const created = await fixture.app.createPlayground({
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
      fixture.app.run(created.id, { fromMessageId: "user-config" })
    ).rejects.toThrow(
      'Built-in tool "broken_config" config must be a JSON object.'
    );
  } finally {
    await fixture.close();
  }
});

/** Creates all adapters over one physical SQLite path where applicable. */
async function _fixture(storageKind: "memory" | "sqlite") {
  const root = await mkdtemp(join(tmpdir(), "llm-space-studio-pi-"));
  const path = join(root, "studio.sqlite");
  const repository = new BunSqliteSessionRepository({ path });
  const bindings = new BunSqliteRuntimeBindingStore({ path });
  const assistantExecutor: AssistantExecutor = {
    execute: () => Promise.resolve(structuredClone(ASSISTANT)),
  };
  const runtime = new DurablePiRuntime({
    repository,
    bindings,
    assistantExecutor,
  });
  const store: StudioStore =
    storageKind === "memory"
      ? new InMemoryStudioStore()
      : createSqliteStudioStore({ path });
  const app = createPlaygroundApplication({ runtime, store });
  return {
    app,
    runtime,
    store,
    async close() {
      await app.close();
      bindings.close();
      await repository.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}
