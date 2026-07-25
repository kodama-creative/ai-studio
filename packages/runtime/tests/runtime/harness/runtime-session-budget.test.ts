import { describe, expect, test } from "bun:test";

import { InMemorySessionStore } from "../../../src/runtime/harness/in-memory-session-store";
import {
  decideRuntimeSessionBudget,
  parkRuntimeRunForBudget,
  runtimeSessionBudgetView
} from "../../../src/runtime/harness/runtime-session-budget";
import { SessionStoreConflictError } from "../../../src/runtime/harness/session-store";
import { sha256 } from "../../../src/runtime/harness/sha256";
import { DurableOperationCoordinator } from "../../../src/runtime/operations/durable-operation-coordinator";

describe("Runtime Session token budget", () => {
  test("accounts one settled main provider operation and parks at equality", async () => {
    const { runId, sessionId, store } = await _started({ input: 100, output: 20 });
    const started = await store.load(sessionId);
    if (!started) { throw new Error("Expected Runtime Session"); }
    const requestFingerprint = await sha256("provider-request");
    const resultFingerprint = await sha256("{}");
    const settled = await store.commit({
      sessionId,
      expectedVersion: started.version,
      mutations: [
        {
          type: "startOperation",
          runId,
          stepId: `${runId}:step:1`,
          stepSequence: 1,
          transcriptMessageCount: 1,
          operationId: `${runId}:step:1:provider:fake`,
          kind: "provider",
          provider: "fake",
          requestFingerprint
        },
        {
          type: "settleOperation",
          runId,
          operationId: `${runId}:step:1:provider:fake`,
          requestFingerprint,
          state: "completed",
          replay: {
            byteLength: 2,
            resultFingerprint,
            value: {}
          },
          mainProviderUsage: { input: 100, output: 5, metered: true }
        }
      ]
    });

    const parked = await parkRuntimeRunForBudget(store, {
      sessionId,
      runId,
      expectedVersion: settled.version
    });
    expect(parked.snapshot.runs.at(-1)?.state).toBe("waitingForBudget");
    expect(runtimeSessionBudgetView(parked)).toMatchObject({
      inputBaseline: 0,
      inputTokens: 100,
      outputBaseline: 0,
      outputTokens: 5,
      unmeteredProviderCalls: 0,
      wait: {
        baseline: { input: 0, output: 0 },
        lifetime: { input: 100, output: 5 },
        reached: ["input"],
        status: "waiting",
        window: {
          input: 100,
          output: 5
        }
      }
    });
  });

  test("fresh-window grant advances both baselines and CAS wins once", async () => {
    const waiting = await _waiting();
    const granted = await decideRuntimeSessionBudget(waiting.store, {
      sessionId: waiting.sessionId,
      runId: waiting.runId,
      expectedVersion: waiting.session.version,
      decision: "freshWindow"
    });

    expect(granted.snapshot.runs.at(-1)?.state).toBe("runningModel");
    expect(runtimeSessionBudgetView(granted)).toMatchObject({
      inputBaseline: 100,
      inputTokens: 100,
      outputBaseline: 5,
      outputTokens: 5,
      wait: { status: "granted" }
    });
    expect(await _rejection(decideRuntimeSessionBudget(waiting.store, {
      sessionId: waiting.sessionId,
      runId: waiting.runId,
      expectedVersion: waiting.session.version,
      decision: "freshWindow"
    }))).toBeInstanceOf(SessionStoreConflictError);
  });

  test("stop cancels the active Run without resetting lifetime usage", async () => {
    const waiting = await _waiting();
    const stopped = await decideRuntimeSessionBudget(waiting.store, {
      sessionId: waiting.sessionId,
      runId: waiting.runId,
      expectedVersion: waiting.session.version,
      decision: "stop"
    });

    expect(stopped.snapshot.activeRunId).toBeNull();
    expect(stopped.snapshot.runs.at(-1)?.state).toBe("cancelled");
    expect(runtimeSessionBudgetView(stopped)).toMatchObject({
      inputBaseline: 0,
      inputTokens: 100,
      outputBaseline: 0,
      outputTokens: 5,
      wait: { status: "stopped" }
    });
  });

  test("records dispatched all-zero usage as unmetered without estimation", async () => {
    const { runId, sessionId, store } = await _started({ input: 100, output: 20 });
    const started = await store.load(sessionId);
    if (!started) { throw new Error("Expected Runtime Session"); }
    const requestFingerprint = await sha256("unmetered-request");
    const resultFingerprint = await sha256("{}");
    const settled = await store.commit({
      sessionId,
      expectedVersion: started.version,
      mutations: [
        {
          type: "startOperation",
          runId,
          stepId: `${runId}:step:1`,
          stepSequence: 1,
          transcriptMessageCount: 1,
          operationId: `${runId}:step:1:provider:fake`,
          kind: "provider",
          provider: "fake",
          requestFingerprint
        },
        {
          type: "settleOperation",
          runId,
          operationId: `${runId}:step:1:provider:fake`,
          requestFingerprint,
          state: "completed",
          replay: { byteLength: 2, resultFingerprint, value: {} },
          mainProviderUsage: { input: 0, output: 0, metered: false }
        }
      ]
    });

    expect(runtimeSessionBudgetView(settled)).toMatchObject({
      inputTokens: 0,
      outputTokens: 0,
      unmeteredProviderCalls: 1,
      wait: null
    });
  });

  test("counts a failed main provider settlement when it carries real usage", async () => {
    const started = await _started({ input: 100, output: 20 });
    const current = await started.store.load(started.sessionId);
    if (!current) { throw new Error("Expected Runtime Session"); }
    const requestFingerprint = await sha256("failed-provider-request");
    const settled = await started.store.commit({
      sessionId: started.sessionId,
      expectedVersion: current.version,
      mutations: [
        {
          type: "startOperation",
          runId: started.runId,
          stepId: `${started.runId}:step:1`,
          stepSequence: 1,
          transcriptMessageCount: 1,
          operationId: `${started.runId}:step:1:provider:fake`,
          kind: "provider",
          provider: "fake",
          requestFingerprint
        },
        {
          type: "settleOperation",
          runId: started.runId,
          operationId: `${started.runId}:step:1:provider:fake`,
          requestFingerprint,
          state: "failed",
          replay: {
            byteLength: 2,
            resultFingerprint: await sha256("{}"),
            value: {}
          },
          mainProviderUsage: { input: 7, output: 3, metered: true }
        }
      ]
    });

    expect(runtimeSessionBudgetView(settled)).toMatchObject({
      inputTokens: 7,
      outputTokens: 3,
      unmeteredProviderCalls: 0
    });
  });

  test("excludes auxiliary compaction usage from the Session totals", async () => {
    const started = await _started({ input: 100, output: 20 });
    const coordinator = new DurableOperationCoordinator({
      runId: started.runId,
      sessionId: started.sessionId,
      sessionStore: started.store
    });
    await coordinator.completeAuxiliaryProvider({
      execute: async () => Promise.resolve({
        role: "assistant",
        content: [{ type: "text", text: "summary" }],
        api: "fake",
        provider: "fake",
        model: "fake-model",
        usage: {
          input: 50,
          output: 10,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 60,
          cost: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            total: 0
          }
        },
        stopReason: "stop",
        timestamp: Date.now()
      }),
      provider: "fake",
      request: { compact: true },
      slot: "compaction-1",
      transcriptMessageCount: 1
    });

    const settled = await started.store.load(started.sessionId);
    if (!settled) { throw new Error("Expected Runtime Session"); }
    expect(runtimeSessionBudgetView(settled)).toMatchObject({
      inputTokens: 0,
      outputTokens: 0,
      unmeteredProviderCalls: 0
    });
  });

  test("hydrates budget history and keeps lifetime totals for a checkpoint-based start", async () => {
    const waiting = await _waiting();
    const stopped = await decideRuntimeSessionBudget(waiting.store, {
      sessionId: waiting.sessionId,
      runId: waiting.runId,
      expectedVersion: waiting.session.version,
      decision: "stop"
    });
    const checkpointed = await waiting.store.commit({
      sessionId: waiting.sessionId,
      expectedVersion: stopped.version,
      mutations: [{
        type: "recordCheckpoint",
        runId: waiting.runId,
        messages: [{ role: "user", content: "original" }],
        continuationFingerprint: "continuation-stopped"
      }]
    });
    const hydratedStore = new InMemorySessionStore([checkpointed]);
    const hydrated = await hydratedStore.load(waiting.sessionId);
    expect(hydrated).toEqual(checkpointed);
    if (!hydrated) { throw new Error("Expected hydrated Runtime Session"); }
    const checkpoint = hydrated.snapshot.history.checkpoints.at(-1);
    if (!checkpoint) { throw new Error("Expected Runtime checkpoint"); }
    const branched = await hydratedStore.commit({
      sessionId: waiting.sessionId,
      expectedVersion: hydrated.version,
      mutations: [{
        type: "startRun",
        runId: "run-after-restore",
        messages: [{ role: "user", content: "restored" }],
        configuration: {
          id: "configuration-after-restore",
          agentSnapshotFingerprint: "agent-budget",
          contextFingerprint: "context-after-restore",
          executionMode: "react",
          limits: {
            maxInputTokensPerSession: 100,
            maxOutputTokensPerSession: 20
          },
          model: { provider: "fake", id: "fake-model" },
          toolConfigurationFingerprint: "tools-budget"
        },
        workingBase: {
          branchId: checkpoint.branchId,
          checkpointId: checkpoint.id
        }
      }]
    });

    expect(runtimeSessionBudgetView(branched)).toMatchObject({
      inputTokens: 100,
      outputTokens: 5,
      wait: { status: "stopped" }
    });
  });
});

async function _waiting() {
  const started = await _started({ input: 100, output: 20 });
  const current = await started.store.load(started.sessionId);
  if (!current) { throw new Error("Expected Runtime Session"); }
  const requestFingerprint = await sha256("waiting-request");
  const resultFingerprint = await sha256("{}");
  const settled = await started.store.commit({
    sessionId: started.sessionId,
    expectedVersion: current.version,
    mutations: [
      {
        type: "startOperation",
        runId: started.runId,
        stepId: `${started.runId}:step:1`,
        stepSequence: 1,
        transcriptMessageCount: 1,
        operationId: `${started.runId}:step:1:provider:fake`,
        kind: "provider",
        provider: "fake",
        requestFingerprint
      },
      {
        type: "settleOperation",
        runId: started.runId,
        operationId: `${started.runId}:step:1:provider:fake`,
        requestFingerprint,
        state: "completed",
        replay: { byteLength: 2, resultFingerprint, value: {} },
        mainProviderUsage: { input: 100, output: 5, metered: true }
      }
    ]
  });
  const session = await parkRuntimeRunForBudget(started.store, {
    sessionId: started.sessionId,
    runId: started.runId,
    expectedVersion: settled.version
  });
  return { ...started, session };
}

async function _started(limits: { input: number; output: number; }) {
  const store = new InMemorySessionStore();
  const sessionId = crypto.randomUUID();
  const runId = crypto.randomUUID();
  await store.commit({
    sessionId,
    expectedVersion: null,
    mutations: [{
      type: "startRun",
      runId,
      messages: [{ role: "user", content: "test" }],
      configuration: {
        id: crypto.randomUUID(),
        agentSnapshotFingerprint: "agent-budget",
        contextFingerprint: "context-budget",
        executionMode: "react",
        limits: {
          maxInputTokensPerSession: limits.input,
          maxOutputTokensPerSession: limits.output
        },
        model: { provider: "fake", id: "fake-model" },
        toolConfigurationFingerprint: "tools-budget"
      }
    }]
  });
  return { runId, sessionId, store };
}

async function _rejection(input: Promise<unknown>): Promise<unknown> {
  try {
    await input;
  } catch (error) {
    return error;
  }
  throw new Error("Expected rejection");
}
