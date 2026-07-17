import { describe, expect, test } from "bun:test";
import { Type } from "typebox";

import {
  AgentSessionState,
  AgentStateCommitUnknownError,
  getActiveAgentSessionContext
} from "./agent-session-state";
import { defineState } from "../../public/definitions/state";
import { InMemorySessionStore } from "../harness/in-memory-session-store";

import type { CompiledAgentStateDefinition } from "../agent/agent-project-snapshot";
import type {
  SessionStore,
  StoredRuntimeSession
} from "../harness/session-store";

const COUNTER = defineState({
  name: "demo.counter",
  version: 1,
  schema: Type.Object({ count: Type.Number() }),
  initial: { count: 0 }
});

const DEFINITION: CompiledAgentStateDefinition = {
  name: COUNTER.name,
  version: COUNTER.version,
  schema: COUNTER.schema,
  schemaFingerprint: "counter-schema-v1",
  initial: COUNTER.initial,
  sourcePath: "state/counter.ts"
};

const NOTE = defineState({
  name: "demo.note",
  version: 1,
  schema: Type.Object({ value: Type.String() }),
  initial: { value: "" }
});

const NOTE_DEFINITION: CompiledAgentStateDefinition = {
  name: NOTE.name,
  version: NOTE.version,
  schema: NOTE.schema,
  schemaFingerprint: "note-schema-v1",
  initial: NOTE.initial,
  sourcePath: "state/note.ts"
};

const CONTEXT = {
  id: "session-state-test",
  auth: {
    initiator: {
      issuer: "test",
      principalId: "initiator",
      principalType: "user" as const
    },
    current: {
      issuer: "test",
      principalId: "current",
      principalType: "service" as const
    }
  },
  tenant: { issuer: "test", tenantId: "tenant-1" },
  channel: { kind: "test", id: "channel-1" },
  turn: { id: "turn-1", sequence: 1 }
};

describe("AgentSessionState", () => {
  test("shares one frozen step map across parallel tools and commits once", async () => {
    const store = new InMemorySessionStore();
    const committed: StoredRuntimeSession[] = [];
    const state = new AgentSessionState({
      context: CONTEXT,
      definitions: [DEFINITION, NOTE_DEFINITION],
      sessionStore: store,
      onCommitted: session => { committed.push(session); }
    });
    let releaseFirst!: () => void;
    const firstUpdated = new Promise<void>(resolve => {
      releaseFirst = resolve;
    });

    const first = state.executeTool(async () => {
      expect(Object.isFrozen(COUNTER.get())).toBe(true);
      COUNTER.update(current => ({ count: current.count + 1 }));
      NOTE.update(() => ({ value: "first" }));
      releaseFirst();
      await Promise.resolve();
      const activeContext = getActiveAgentSessionContext();
      expect(activeContext).toEqual(CONTEXT);
      expect(Object.isFrozen(activeContext)).toBe(true);
      expect(Object.isFrozen(activeContext.auth.current)).toBe(true);
    });
    const second = state.executeTool(async () => {
      await firstUpdated;
      expect(COUNTER.get()).toEqual({ count: 1 });
      COUNTER.update(current => ({ count: current.count + 1 }));
      NOTE.update(current => ({ value: `${current.value}-second` }));
    });
    await Promise.all([first, second]);
    await state.completeStep([]);

    const stored = await store.load(CONTEXT.id);
    expect(stored?.snapshot.state).toMatchObject({
      revision: 1,
      values: {
        "demo.counter": { value: { count: 2 } },
        "demo.note": { value: { value: "first-second" } }
      }
    });
    expect(committed).toHaveLength(1);
    expect(stored?.journal.at(-1)).toMatchObject({
      type: "sessionStateReplaced",
      names: ["demo.counter", "demo.note"]
    });
  });

  test("rolls back the entire step when one tool throws", async () => {
    const store = new InMemorySessionStore();
    const state = new AgentSessionState({
      context: CONTEXT,
      definitions: [DEFINITION],
      sessionStore: store
    });
    await state.executeTool(async () => {
      COUNTER.update(() => ({ count: 3 }));
    });
    await state.completeStep([]);

    await Promise.allSettled([
      state.executeTool(async () => {
        COUNTER.update(() => ({ count: 9 }));
      }),
      state.executeTool(async () => {
        throw new Error("tool failed");
      })
    ]);
    await state.completeStep([]);
    expect((await store.load(CONTEXT.id))?.snapshot.state?.values[
      COUNTER.name
    ]?.value).toEqual({ count: 3 });
  });

  test("uses last actual write wins for same-key parallel updates", async () => {
    const store = new InMemorySessionStore();
    const state = new AgentSessionState({
      context: CONTEXT,
      definitions: [DEFINITION],
      sessionStore: store
    });
    let releaseLateWrite!: () => void;
    const lateWrite = new Promise<void>(resolve => {
      releaseLateWrite = resolve;
    });
    const first = state.executeTool(async () => {
      await lateWrite;
      COUNTER.update(() => ({ count: 1 }));
    });
    const second = state.executeTool(async () => {
      COUNTER.update(() => ({ count: 2 }));
      releaseLateWrite();
    });
    await Promise.all([first, second]);
    await state.completeStep([]);

    expect((await store.load(CONTEXT.id))?.snapshot.state?.values[
      COUNTER.name
    ]?.value).toEqual({ count: 1 });
  });

  test("does not rerun tools and reports an unknown outcome on commit failure", async () => {
    let executions = 0;
    const store: SessionStore = {
      load: async () => null,
      commit: async () => { throw new Error("disk unavailable"); }
    };
    const state = new AgentSessionState({
      context: CONTEXT,
      definitions: [DEFINITION],
      sessionStore: store
    });
    await state.executeTool(async () => {
      executions += 1;
      COUNTER.update(() => ({ count: 1 }));
    });
    expect(await _rejection(state.completeStep([]))).toBeInstanceOf(
      AgentStateCommitUnknownError
    );
    expect(executions).toBe(1);
  });

  test("discards updates when Pi finalizes a tool result as an error", async () => {
    const store = new InMemorySessionStore();
    const state = new AgentSessionState({
      context: CONTEXT,
      definitions: [DEFINITION],
      sessionStore: store
    });
    await state.executeTool(async () => {
      COUNTER.update(() => ({ count: 5 }));
    });
    await state.completeStep([{
      role: "toolResult",
      toolCallId: "call-error",
      toolName: "counter",
      content: [{ type: "text", text: "recoverable error" }],
      isError: true,
      timestamp: Date.now()
    }]);
    expect(await store.load(CONTEXT.id)).toBeNull();
  });

  test("discards updates when an automatic step contains a deferred result", async () => {
    const store = new InMemorySessionStore();
    const state = new AgentSessionState({
      context: CONTEXT,
      definitions: [DEFINITION],
      sessionStore: store
    });
    await state.executeTool(async () => {
      COUNTER.update(() => ({ count: 7 }));
    });

    await state.completeStep([], { deferred: true });

    expect(await store.load(CONTEXT.id)).toBeNull();
  });

  test("blocks schema drift before authored tool code runs", async () => {
    const store = new InMemorySessionStore();
    await store.commit({
      sessionId: CONTEXT.id,
      expectedVersion: null,
      mutations: [{
        type: "replaceState",
        values: {
          [COUNTER.name]: {
            definitionVersion: 1,
            schemaFingerprint: "older-schema",
            value: { count: 4 }
          }
        }
      }]
    });
    const state = new AgentSessionState({
      context: CONTEXT,
      definitions: [DEFINITION],
      sessionStore: store
    });
    let executed = false;
    expect(await _rejection(state.executeTool(async () => {
      executed = true;
    }))).toMatchObject({
      message: expect.stringContaining("schema does not match")
    });
    expect(executed).toBe(false);
  });

  test("blocks removed definitions and version drift during Session validation", async () => {
    const store = new InMemorySessionStore();
    await store.commit({
      sessionId: CONTEXT.id,
      expectedVersion: null,
      mutations: [{
        type: "replaceState",
        values: {
          [COUNTER.name]: {
            definitionVersion: 2,
            schemaFingerprint: DEFINITION.schemaFingerprint,
            value: { count: 4 }
          }
        }
      }]
    });
    expect(await _rejection(new AgentSessionState({
      context: CONTEXT,
      definitions: [DEFINITION],
      sessionStore: store
    }).validateSession())).toMatchObject({
      message: expect.stringContaining("version 2")
    });
    expect(await _rejection(new AgentSessionState({
      context: CONTEXT,
      definitions: [],
      sessionStore: store
    }).validateSession())).toMatchObject({
      message: expect.stringContaining("has no authored definition")
    });
  });
});

async function _rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("Expected operation to reject");
}
