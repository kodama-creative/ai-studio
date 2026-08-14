import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
  BunSqliteRuntimeBindingStore,
  BunSqliteSessionRepository,
  StudioPiSessionRuntime,
  type AssistantExecutor,
} from "@llm-space/pi-runtime";
import { Database } from "bun:sqlite";

import type { StudioAgentSnapshot } from "./pi-domain";
import { InMemoryStudioStore, type StudioStore } from "./storage";
import { createSqliteStudioStore } from "./storage/sqlite";
import { createStudioApplication } from "./studio-application";

const AGENT: StudioAgentSnapshot = {
  agentSpecId: "general-agent",
  sourceRevision: "source-1",
  model: "test/local",
  instructions: ["Answer concisely."],
  tools: [],
};

describe.each(["memory", "sqlite"] as const)(
  "StudioApplication with %s metadata storage",
  (storageKind) => {
    test("uses Pi Session as transcript truth and Studio as operation index", async () => {
      const fixture = await _fixture(storageKind);
      try {
        const created = await fixture.app.createThread({ agent: AGENT });
        expect(typeof created.sessionId).toBe("string");
        expect(created).toMatchObject({
          lane: "main",
          leafId: null,
          runtimeFormatVersion: 1,
        });
        const saved = await fixture.app.saveDocument(created.id, {
          ...created.document,
          conversation: {
            messages: [
              {
                id: "user-1",
                role: "user",
                content: [{ type: "text", text: "hello" }],
              },
            ],
            state: { project: true },
          },
        });
        expect(saved.document.conversation.messages).toHaveLength(1);

        const receipt = await fixture.app.run(created.id, {
          fromMessageId: "user-1",
          mode: "step",
        });
        const loaded = await fixture.app.loadThread(created.id);
        expect(loaded).toMatchObject({
          sessionId: receipt.sessionId,
          document: {
            conversation: {
              state: { project: true },
              messages: [
                { role: "user" },
                {
                  role: "assistant",
                  content: [{ type: "text", text: "answer-1" }],
                },
              ],
            },
          },
        });
        expect(loaded).not.toHaveProperty("operationId");
        expect(await fixture.app.listRunHistory(created.id)).toMatchObject([
          {
            reference: {
              sessionId: receipt.sessionId,
              operationId: receipt.operationId,
              relation: "executed",
            },
            operation: {
              operationId: receipt.operationId,
              status: "completed",
            },
            checkpoint: {
              sessionId: receipt.sessionId,
              operationId: receipt.operationId,
            },
          },
        ]);
        expect(
          fixture.store.transaction((tx) => tx.getExperiment(created.id))
        ).not.toHaveProperty("draft");
      } finally {
        await fixture.close();
      }
    });
  }
);

test("forks a Pi branch and marks inherited operation references", async () => {
  const fixture = await _fixture("memory");
  try {
    const created = await fixture.app.createThread({
      agent: AGENT,
      conversation: {
        messages: [
          {
            id: "user-fork",
            role: "user",
            content: [{ type: "text", text: "fork me" }],
          },
        ],
        state: {},
      },
    });
    const receipt = await fixture.app.run(created.id, {
      fromMessageId: "user-fork",
      mode: "step",
    });
    const fork = await fixture.app.forkThread(created.id);

    expect(fork.sessionId).not.toBe(receipt.sessionId);
    expect(fork.provenance).toEqual({ type: "fork", threadId: created.id });
    expect(await fixture.app.listRunHistory(fork.id)).toMatchObject([
      {
        reference: {
          sessionId: receipt.sessionId,
          operationId: receipt.operationId,
          relation: "inherited",
        },
      },
    ]);
  } finally {
    await fixture.close();
  }
});

test("evaluations target Pi operation ids and events use operation vocabulary", async () => {
  const fixture = await _fixture("memory");
  try {
    const created = await fixture.app.createThread({
      agent: AGENT,
      conversation: {
        messages: [
          {
            id: "user-1",
            role: "user",
            content: [{ type: "text", text: "one" }],
          },
        ],
        state: {},
      },
    });
    const first = await fixture.app.run(created.id, {
      fromMessageId: "user-1",
      mode: "step",
    });
    const afterFirst = (await fixture.app.loadThread(created.id))!;
    await fixture.app.saveDocument(created.id, {
      ...afterFirst.document,
      conversation: {
        ...afterFirst.document.conversation,
        messages: [
          ...afterFirst.document.conversation.messages,
          {
            id: "user-2",
            role: "user",
            content: [{ type: "text", text: "two" }],
          },
        ],
      },
    });
    const second = await fixture.app.run(created.id, {
      fromMessageId: "user-2",
      mode: "step",
    });
    const metadata = await fixture.app.saveEvaluationMetadata(created.id, {
      evaluations: [
        {
          id: "evaluation-1",
          leftOperationId: first.operationId,
          rightOperationId: second.operationId,
          verdict: "leftBetter",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      rubrics: [],
    });
    expect(metadata.evaluations[0]).toMatchObject({
      leftOperationId: first.operationId,
      rightOperationId: second.operationId,
    });
    const events = [];
    for await (const event of fixture.app.events(created.id))
      events.push(event);
    expect(events.map((item) => item.event.type)).toContain(
      "operation.completed"
    );
  } finally {
    await fixture.close();
  }
});

test("shared Studio SQLite writes Pi/runtime-binding/Studio tables and no Engine tables", async () => {
  const fixture = await _fixture("sqlite");
  try {
    const created = await fixture.app.createThread({
      agent: AGENT,
      conversation: {
        messages: [
          {
            id: "user-schema",
            role: "user",
            content: [{ type: "text", text: "schema" }],
          },
        ],
        state: {},
      },
    });
    await fixture.app.run(created.id, {
      fromMessageId: "user-schema",
      mode: "step",
    });
    const database = new Database(fixture.path, { readonly: true });
    try {
      const tables = database
        .query<{ name: string }, []>(
          "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
        )
        .all()
        .map((row) => row.name);
      expect(tables).toContain("pi_sessions");
      expect(tables).toContain("llm_space_runtime_bindings");
      expect(tables).toContain("studio_experiments");
      expect(tables.some((name) => name.startsWith("engine_"))).toBeFalse();
    } finally {
      database.close();
    }
  } finally {
    await fixture.close();
  }
});

/** Creates Studio, Pi repository, and binding adapters over one test database. */
async function _fixture(storageKind: "memory" | "sqlite") {
  const root = await mkdtemp(join(tmpdir(), "llm-space-project-pi-"));
  const path = join(root, "studio.sqlite");
  const repository = new BunSqliteSessionRepository({ path });
  const bindings = new BunSqliteRuntimeBindingStore({ path });
  let answer = 0;
  const assistantExecutor: AssistantExecutor = {
    execute(input) {
      answer += 1;
      return Promise.resolve(_assistant(`answer-${answer}`, input.operationId));
    },
  };
  const runtime = new StudioPiSessionRuntime({
    repository,
    bindings,
    assistantExecutor,
  });
  const store: StudioStore =
    storageKind === "memory"
      ? new InMemoryStudioStore()
      : createSqliteStudioStore({ path });
  const app = createStudioApplication({
    runtime,
    store,
    resolveCurrentAgent: () =>
      Promise.resolve({ snapshot: AGENT, tools: new Map() }),
  });
  return {
    app,
    store,
    path,
    async close() {
      await app.close();
      bindings.close();
      await repository.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}

/** Produces a complete Pi assistant message for one deterministic model turn. */
function _assistant(text: string, operationId: string): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
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
    timestamp: operationId.length,
  };
}
