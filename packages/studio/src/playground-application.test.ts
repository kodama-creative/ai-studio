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
          commandId: "run-1",
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

test("saves a future Playground Draft while a Pi operation is active", async () => {
  const fixture = await _fixture("memory");
  try {
    const created = await fixture.app.createPlayground({
      title: "Active Playground",
      agentSpec: {
        schemaVersion: 1,
        model: { provider: "test", id: "local" },
        instructions: [],
        tools: [],
      },
      conversation: {
        messages: [
          {
            id: "user-active",
            role: "user",
            content: [{ type: "text", text: "run this version" }],
          },
        ],
        state: {},
      },
    });
    const receipt = await fixture.app.run(created.id, {
      fromMessageId: "user-active",
      commandId: "active-run",
    });
    const active = await fixture.runtime.open({ sessionId: receipt.sessionId });
    if (active.nextAction === undefined) {
      throw new Error("Expected an active Playground model action.");
    }

    const saved = await fixture.app.savePlayground(created.id, {
      title: "Edited while active",
      agentSpec: created.agentSpec,
      conversation: {
        messages: [
          {
            id: "user-active",
            role: "user",
            content: [{ type: "text", text: "run the next version" }],
          },
        ],
        state: { next: true },
      },
    });
    expect(saved).toMatchObject({
      operationId: receipt.operationId,
      title: "Edited while active",
      dirty: true,
      conversation: { state: { next: true } },
    });

    await fixture.app.stepRun(created.id, receipt.operationId, {
      commandId: "finish-active-run",
      expectedActionId: active.nextAction.id,
      kind: active.nextAction.kind,
    });
    const loaded = await fixture.app.loadPlayground(created.id);
    expect(loaded).toMatchObject({
      title: "Edited while active",
      dirty: true,
      conversation: {
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "run the next version" }],
          },
        ],
        state: { next: true },
      },
    });
    expect(loaded).not.toHaveProperty("operationId");
  } finally {
    await fixture.close();
  }
});

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
      fixture.app.run(created.id, {
        fromMessageId: "user-native",
        commandId: "run-native",
      })
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
      fixture.app.run(created.id, {
        fromMessageId: "user-config",
        commandId: "run-config",
      })
    ).rejects.toThrow(
      'Built-in tool "broken_config" config must be a JSON object.'
    );
  } finally {
    await fixture.close();
  }
});

test("reconciles an admitted Playground operation after metadata commit failed", async () => {
  const fixture = await _fixture("memory", { failAdmissionCommit: true });
  try {
    const created = await fixture.app.createPlayground({
      agentSpec: {
        schemaVersion: 1,
        model: { provider: "test", id: "local" },
        instructions: ["Recover."],
        tools: [],
      },
      conversation: {
        messages: [
          {
            id: "user-crash",
            role: "user",
            content: [{ type: "text", text: "recover" }],
          },
        ],
        state: { durable: true },
      },
    });
    const input = {
      fromMessageId: "user-crash",
      commandId: "admission-crash",
      mode: "step" as const,
    };

    expect(fixture.app.run(created.id, input)).rejects.toThrow(
      "simulated Playground admission crash"
    );
    const receipt = await fixture.app.run(created.id, input);

    expect(await fixture.app.listRuns(created.id)).toMatchObject([
      { operationId: receipt.operationId, status: "completed" },
    ]);
    expect(await fixture.app.loadPlayground(created.id)).toMatchObject({
      dirty: false,
      conversation: {
        state: { durable: true },
        messages: [{ role: "user" }, { role: "assistant" }],
      },
    });
  } finally {
    await fixture.close();
  }
});

/** Creates all adapters over one physical SQLite path where applicable. */
async function _fixture(
  storageKind: "memory" | "sqlite",
  options: { readonly failAdmissionCommit?: boolean } = {}
) {
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
  const innerStore: StudioStore =
    storageKind === "memory"
      ? new InMemoryStudioStore()
      : createSqliteStudioStore({ path });
  let failAdmissionCommit = options.failAdmissionCommit ?? false;
  const store: StudioStore = failAdmissionCommit
    ? {
        transaction(fn) {
          return innerStore.transaction((tx) => {
            const faulting = Object.create(tx) as typeof tx;
            faulting.savePlayground = (playground) => {
              if (failAdmissionCommit && playground.draft === undefined) {
                failAdmissionCommit = false;
                throw new Error("simulated Playground admission crash");
              }
              tx.savePlayground(playground);
            };
            return fn(faulting);
          });
        },
        close: () => innerStore.close(),
      }
    : innerStore;
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
