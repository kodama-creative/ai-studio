import { describe, expect, test } from "bun:test";

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type {
  Api,
  AssistantMessage,
  Context,
  Model,
  Models,
  SimpleStreamOptions
} from "@earendil-works/pi-ai";

import { RuntimeCompactionCoordinator } from "../../../src/runtime/compaction/runtime-compaction-coordinator";
import { DurableOperationOutcomeUnknownError } from "../../../src/runtime/harness/durable-operation-outcome-unknown-error";
import { InMemorySessionStore } from "../../../src/runtime/harness/in-memory-session-store";
import { DurableOperationCoordinator } from "../../../src/runtime/operations/durable-operation-coordinator";

import type {
  SessionStore,
  SessionStoreCommit,
  StoredRuntimeSession
} from "../../../src/runtime/harness/session-store";

describe("RuntimeCompactionCoordinator", () => {
  test("stores one durable summary and projects it after restart", async () => {
    const messages = _longMessages();
    const store = await _startedStore("session-compact", "run-compact", messages);
    let summaryDispatches = 0;
    const models = _models(async () => {
      summaryDispatches += 1;
      return _assistant("## Goal\nKeep the important context.");
    });
    const first = _coordinator(store, models, "session-compact", "run-compact");

    const projected = await first.transform(messages, MODEL, "off");
    const persisted = await store.load("session-compact");

    expect(summaryDispatches).toBe(1);
    expect(projected[0]).toMatchObject({ role: "compactionSummary" });
    expect(projected.length).toBeLessThan(messages.length);
    expect(persisted?.snapshot.history.entries).toHaveLength(messages.length);
    expect(persisted?.snapshot.history.compactions).toEqual([
      expect.objectContaining({
        id: "run-compact:compaction:1",
        runId: "run-compact",
        summary: "## Goal\nKeep the important context."
      })
    ]);
    expect(persisted?.snapshot.operationLedger?.steps).toEqual([
      expect.objectContaining({
        state: "checkpointed",
        operations: [expect.objectContaining({ state: "completed" })]
      })
    ]);

    const restarted = _coordinator(
      store,
      models,
      "session-compact",
      "run-compact"
    );
    const replayedProjection = await restarted.transform(
      messages,
      MODEL,
      "off"
    );
    expect(summaryDispatches).toBe(1);
    expect(replayedProjection).toEqual(projected);
  });

  test("fails closed on a known summarization failure", async () => {
    const messages = _longMessages();
    const store = await _startedStore("session-failed", "run-failed", messages);
    const coordinator = _coordinator(
      store,
      _models(async () => _assistant("", "error")),
      "session-failed",
      "run-failed"
    );

    expect(await coordinator.transform(messages, MODEL, "off")).toEqual(
      messages
    );
    expect(coordinator.terminalError).toMatchObject({
      code: "summarization_failed"
    });
    const persisted = await store.load("session-failed");
    expect(persisted?.snapshot.history.compactions).toEqual([]);
    expect(persisted?.snapshot.operationLedger?.steps[0]).toMatchObject({
      state: "checkpointed",
      operations: [expect.objectContaining({ state: "failed" })]
    });
  });

  test("keeps an aborted dispatched summary outcome unknown", async () => {
    const messages = _longMessages();
    const store = await _startedStore("session-unknown", "run-unknown", messages);
    const coordinator = _coordinator(
      store,
      _models(async () => _assistant("", "aborted")),
      "session-unknown",
      "run-unknown"
    );

    await coordinator.transform(messages, MODEL, "off");
    expect(coordinator.terminalError).toBeInstanceOf(
      DurableOperationOutcomeUnknownError
    );
    const persisted = await store.load("session-unknown");
    expect(persisted?.snapshot.history.compactions).toEqual([]);
    expect(persisted?.snapshot.operationLedger?.steps[0]).toMatchObject({
      operations: [expect.objectContaining({ state: "outcomeUnknown" })]
    });
  });

  test("marks summary completion persistence uncertainty unknown", async () => {
    const messages = _longMessages();
    const backing = await _startedStore(
      "session-completion-unknown",
      "run-completion-unknown",
      messages
    );
    const store = _failingStore(backing, commit => commit.mutations.some(
      mutation => mutation.type === "settleOperation"
        && mutation.state === "completed"
    ));
    let summaryDispatches = 0;
    const coordinator = _coordinator(
      store,
      _models(async () => {
        summaryDispatches += 1;
        return _assistant("Summary whose commit is uncertain");
      }),
      "session-completion-unknown",
      "run-completion-unknown"
    );

    expect(await coordinator.transform(messages, MODEL, "off")).toEqual(
      messages
    );
    expect(summaryDispatches).toBe(1);
    expect(coordinator.terminalError).toBeInstanceOf(
      DurableOperationOutcomeUnknownError
    );
    expect((await backing.load("session-completion-unknown"))
      ?.snapshot.history.compactions).toEqual([]);
    expect((await backing.load("session-completion-unknown"))
      ?.snapshot.operationLedger?.steps[0]?.operations[0]?.state)
      .toBe("outcomeUnknown");
  });

  test("replays a durable summary after compaction-record commit failure", async () => {
    const messages = _longMessages();
    const backing = await _startedStore(
      "session-record-retry",
      "run-record-retry",
      messages
    );
    const store = _failingStore(backing, commit => commit.mutations.some(
      mutation => mutation.type === "recordCompaction"
    ));
    let summaryDispatches = 0;
    const models = _models(async () => {
      summaryDispatches += 1;
      return _assistant("Durable summary before record retry");
    });
    const first = _coordinator(
      store,
      models,
      "session-record-retry",
      "run-record-retry"
    );

    expect(await first.transform(messages, MODEL, "off")).toEqual(messages);
    expect(first.terminalError?.message).toContain("Injected commit failure");
    expect(summaryDispatches).toBe(1);
    expect((await backing.load("session-record-retry"))
      ?.snapshot.history.compactions).toEqual([]);

    const restarted = _coordinator(
      store,
      models,
      "session-record-retry",
      "run-record-retry"
    );
    const projected = await restarted.transform(messages, MODEL, "off");

    expect(summaryDispatches).toBe(1);
    expect(restarted.terminalError).toBeNull();
    expect(projected[0]).toMatchObject({ role: "compactionSummary" });
    expect((await backing.load("session-record-retry"))
      ?.snapshot.history.compactions).toEqual([
      expect.objectContaining({ summary: "Durable summary before record retry" })
    ]);
  });

  test("explicitly compacts below the automatic threshold", async () => {
    const messages = _longMessages();
    const store = await _startedStore(
      "session-explicit",
      "run-explicit",
      messages
    );
    let summaryDispatches = 0;
    const model = { ...MODEL, contextWindow: 1_000_000 };
    const coordinator = _coordinator(
      store,
      _models(async () => {
        summaryDispatches += 1;
        return _assistant("Explicit summary");
      }),
      "session-explicit",
      "run-explicit"
    );

    expect(await coordinator.compactNow(messages, model, "off")).toBe(true);
    expect(summaryDispatches).toBe(1);
    expect((await store.load("session-explicit"))?.snapshot.history.compactions)
      .toEqual([
        expect.objectContaining({
          runId: "run-explicit",
          summary: "Explicit summary"
        })
      ]);
  });
});

const MODEL: Model<"fake"> = {
  id: "fake-model",
  name: "Fake",
  api: "fake",
  provider: "fake",
  baseUrl: "http://localhost.invalid",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 32_000,
  maxTokens: 4_096
};

function _coordinator(
  store: SessionStore,
  models: Models,
  sessionId: string,
  runId: string
): RuntimeCompactionCoordinator {
  const durableOperations = new DurableOperationCoordinator({
    sessionId,
    runId,
    sessionStore: store
  });
  return new RuntimeCompactionCoordinator({
    durableOperations,
    models,
    sessionId,
    runId,
    sessionStore: store
  });
}

function _failingStore(
  backing: InMemorySessionStore,
  shouldFail: (commit: SessionStoreCommit) => boolean
): SessionStore {
  let failed = false;
  return {
    async load(sessionId: string): Promise<StoredRuntimeSession | null> {
      return backing.load(sessionId);
    },
    async commit(commit: SessionStoreCommit): Promise<StoredRuntimeSession> {
      if (!failed && shouldFail(commit)) {
        failed = true;
        throw new Error("Injected commit failure");
      }
      return backing.commit(commit);
    }
  };
}

async function _startedStore(
  sessionId: string,
  runId: string,
  messages: AgentMessage[]
): Promise<InMemorySessionStore> {
  const store = new InMemorySessionStore();
  await store.commit({
    sessionId,
    expectedVersion: null,
    mutations: [{
      type: "startRun",
      runId,
      messages: messages as unknown as Array<Record<string, unknown>>,
      configuration: {
        id: `configuration-${runId}`,
        agentSnapshotFingerprint: "agent",
        contextFingerprint: "context",
        executionMode: "react",
        model: { provider: MODEL.provider, id: MODEL.id },
        toolConfigurationFingerprint: "tools"
      }
    }]
  });
  return store;
}

function _models(
  complete: (
    model: Model<Api>,
    context: Context,
    options?: SimpleStreamOptions
  ) => Promise<AssistantMessage>
): Models {
  return {
    completeSimple: complete
  } as unknown as Models;
}

function _longMessages(): AgentMessage[] {
  return Array.from({ length: 32 }, (_, index) => ({
    role: "user" as const,
    content: [{
      type: "text" as const,
      text: `${index}: ${"context ".repeat(500)}`
    }],
    timestamp: index
  }));
}

function _assistant(
  text: string,
  stopReason: AssistantMessage["stopReason"] = "stop"
): AssistantMessage {
  return {
    role: "assistant",
    content: text ? [{ type: "text", text }] : [],
    api: "fake",
    provider: "fake",
    model: "fake-model",
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
    },
    stopReason,
    ...(stopReason === "error" ? { errorMessage: "summary unavailable" } : {}),
    timestamp: Date.now()
  };
}
