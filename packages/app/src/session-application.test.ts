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
  type RuntimeBinding,
} from "@llm-space/pi-runtime";
import { Database } from "bun:sqlite";

import type { AppSessionRecord } from "./domain";
import { createSessionApplication } from "./session-application";
import { InMemoryApplicationStore, type ApplicationStore } from "./storage";
import { createSqliteApplicationStore } from "./storage/sqlite";

const BINDING: RuntimeBinding = {
  formatVersion: 1,
  agent: { agentSpecId: "agent-1", sourceRevision: "source-1" },
  model: { provider: "test", modelId: "local" },
  systemPrompt: "Answer concisely.",
  tools: [],
};

const ASSISTANT: AssistantMessage = {
  role: "assistant",
  content: [{ type: "text", text: "Pi-backed answer" }],
  api: "openai-responses",
  provider: "test",
  model: "local",
  usage: {
    input: 1,
    output: 1,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 2,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
  stopReason: "stop",
  timestamp: 2,
};

describe.each(["memory", "sqlite"] as const)(
  "Pi-backed SessionApplication with %s App metadata",
  (storageKind) => {
    test("keeps transcript/timeline in Pi and Tasks as operation references", async () => {
      const fixture = await _fixture(storageKind);
      try {
        const session = await fixture.app.createSession({
          name: "App Session",
          projectId: "project-1",
        });
        expect(session).toMatchObject({
          schemaVersion: 2,
          name: "App Session",
          lane: "main",
          leafId: null,
          runtimeFormatVersion: 1,
        });
        const task = await fixture.app.createTask({
          sessionId: session.sessionId,
          title: "Answer",
        });
        await fixture.app.recordSystemMessage({
          sessionId: session.sessionId,
          code: "ready",
          text: "Ready",
        });
        await fixture.app.recordUserAction({
          sessionId: session.sessionId,
          action: "submit",
        });

        const result = await fixture.app.execute({
          sessionId: session.sessionId,
          taskId: task.id,
          operationId: "operation-1",
          messages: [
            { role: "user", content: "Hello", timestamp: 1 },
          ],
        });

        expect(result).toMatchObject({
          schemaVersion: 2,
          sessionId: session.sessionId,
          operation: { operationId: "operation-1", status: "completed" },
          snapshot: { status: "completed" },
          messages: [
            { role: "user", content: "Hello" },
            { role: "assistant" },
          ],
        });
        expect(await fixture.app.listEntries(session.sessionId)).toMatchObject([
          { type: "custom", customType: "llm-space.system" },
          { type: "custom", customType: "llm-space.user-action" },
          { type: "message", message: { role: "user" } },
          { type: "message", message: { role: "assistant" } },
        ]);
        expect(await fixture.app.listTasks(session.sessionId)).toEqual([
          expect.objectContaining({
            id: task.id,
            operationId: "operation-1",
            status: "completed",
          }),
        ]);
        expect(await fixture.app.listOperations(session.sessionId)).toMatchObject([
          { operationId: "operation-1", status: "completed" },
        ]);
      } finally {
        await fixture.close();
      }
    });
  }
);

test("shares Pi, binding, and App tables without creating Engine tables", async () => {
  const fixture = await _fixture("sqlite");
  try {
    await fixture.app.createSession();
    const database = new Database(fixture.path, { readonly: true });
    try {
      const tables = new Set(
        database
          .query<{ name: string }, []>(
            "SELECT name FROM sqlite_master WHERE type = 'table'"
          )
          .all()
          .map((row) => row.name)
      );
      expect(tables.has("pi_sessions")).toBeTrue();
      expect(tables.has("llm_space_runtime_bindings")).toBeTrue();
      expect(tables.has("app_sessions")).toBeTrue();
      expect([...tables].some((table) => table.startsWith("engine_"))).toBeFalse();
    } finally {
      database.close();
    }
  } finally {
    await fixture.close();
  }
});

test("rejects a foreign Task before admitting a Pi operation", async () => {
  const fixture = await _fixture("memory");
  try {
    const owner = await fixture.app.createSession();
    const target = await fixture.app.createSession();
    const task = await fixture.app.createTask({
      sessionId: owner.sessionId,
      title: "Owned elsewhere",
    });

    expect(
      fixture.app.execute({
        sessionId: target.sessionId,
        taskId: task.id,
        operationId: "must-not-be-admitted",
        messages: [{ role: "user", content: "hello", timestamp: 1 }],
      })
    ).rejects.toThrow(
      `Task "${task.id}" does not belong to Session "${target.sessionId}".`
    );
    expect(await fixture.app.listOperations(target.sessionId)).toEqual([]);
  } finally {
    await fixture.close();
  }
});

test("rolls back a new Pi Session when App metadata insertion fails", async () => {
  const store = new FailOnceSessionInsertStore();
  const fixture = await _fixture("memory", store);
  try {
    const input = { sessionId: "stable-session", name: "Stable" } as const;
    const failure = await _captureError(() => fixture.app.createSession(input));
    expect(failure).toBeInstanceOf(Error);
    expect(
      fixture.runtime.open({ sessionId: input.sessionId })
    ).rejects.toThrow(`Session "${input.sessionId}" was not found.`);

    const created = await fixture.app.createSession(input);
    expect(created).toMatchObject({
      sessionId: input.sessionId,
      name: input.name,
    });
    expect(created).not.toHaveProperty("operationId");
    expect(await fixture.app.listSessions()).toHaveLength(1);
  } finally {
    await fixture.close();
  }
});

test("completed operations are not exposed or aborted as active work", async () => {
  const fixture = await _fixture("memory");
  try {
    const session = await fixture.app.createSession();
    await fixture.app.execute({
      sessionId: session.sessionId,
      operationId: "completed-operation",
      messages: [{ role: "user", content: "hello", timestamp: 1 }],
    });

    await fixture.app.abort(session.sessionId);
    expect(await fixture.app.getSession(session.sessionId)).not.toHaveProperty(
      "operationId"
    );
  } finally {
    await fixture.close();
  }
});

test("replays App metadata from Pi semantic identity after projection fails", async () => {
  let now = 100;
  const store = new FailOnceSessionSaveStore();
  const fixture = await _fixture("memory", store, () => now);
  try {
    const session = await fixture.app.createSession();
    const task = await fixture.app.createTask({
      sessionId: session.sessionId,
      title: "Debug recovery",
    });
    const admitted = await fixture.runtime.start({
      sessionId: session.sessionId,
      operationId: "recovered-operation",
      messages: [{ role: "user", content: "hello", timestamp: 1 }],
      binding: BINDING,
    });
    fixture.store.transaction((tx) =>
      tx.saveTask({
        ...task,
        operationId: "recovered-operation",
        status: "running",
      })
    );
    const action = admitted.nextAction!;
    const command = {
      sessionId: session.sessionId,
      expectedActionId: action.id,
      kind: action.kind,
    } as const;

    now = 200;
    expect(await _captureError(() => fixture.app.step(command))).toBeInstanceOf(
      Error
    );
    expect(await fixture.app.listTasks(session.sessionId)).toMatchObject([
      { status: "running", updatedAt: 100 },
    ]);
    expect(await fixture.app.getSession(session.sessionId)).toMatchObject({
      updatedAt: 100,
    });

    now = 300;
    expect((await fixture.app.step(command)).status).toBe("completed");
    expect(await fixture.app.listTasks(session.sessionId)).toMatchObject([
      { status: "completed", updatedAt: 300 },
    ]);
    expect(await fixture.app.getSession(session.sessionId)).toMatchObject({
      updatedAt: 300,
    });
  } finally {
    await fixture.close();
  }
});

test("rejects Pi Sessions that are not owned by App metadata", async () => {
  const fixture = await _fixture("memory");
  try {
    await fixture.runtime.createSession({ id: "pi-only" });
    const error = await _captureError(() =>
      fixture.app.readCommitted({ sessionId: "pi-only" })
    );
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toContain('Session "pi-only" was not found');
  } finally {
    await fixture.close();
  }
});

test("does not adopt a pre-existing Pi Session during App creation", async () => {
  const fixture = await _fixture("memory");
  try {
    await fixture.runtime.createSession({ id: "pi-only-create" });
    expect(
      fixture.app.createSession({ sessionId: "pi-only-create" })
    ).rejects.toThrow();
    expect(await fixture.app.getSession("pi-only-create")).toBeUndefined();
  } finally {
    await fixture.close();
  }
});

async function _fixture(
  storageKind: "memory" | "sqlite",
  providedStore?: ApplicationStore,
  clock?: () => number
) {
  const root = await mkdtemp(join(tmpdir(), "llm-space-app-pi-"));
  const path = join(root, "agent.sqlite");
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
  const store: ApplicationStore =
    providedStore ??
    (storageKind === "memory"
      ? new InMemoryApplicationStore()
      : createSqliteApplicationStore({ path }));
  const app = createSessionApplication({
    runtime,
    store,
    agentId: "agent-1",
    resolveBinding: () => BINDING,
    ...(clock === undefined ? {} : { clock }),
  });
  return {
    app,
    runtime,
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

class FailOnceSessionInsertStore extends InMemoryApplicationStore {
  private _fail = true;

  override insertSession(session: AppSessionRecord): void {
    if (this._fail) {
      this._fail = false;
      throw new Error("simulated App metadata failure");
    }
    super.insertSession(session);
  }
}

class FailOnceSessionSaveStore extends InMemoryApplicationStore {
  private _fail = true;

  override saveSession(session: AppSessionRecord): void {
    if (this._fail) {
      this._fail = false;
      throw new Error("simulated metadata projection failure");
    }
    super.saveSession(session);
  }
}

async function _captureError(
  operation: () => unknown
): Promise<unknown> {
  try {
    await operation();
    return undefined;
  } catch (error: unknown) {
    return error;
  }
}
