import { createHash } from "node:crypto";
import { InMemorySessionStore } from "@llm-space/runtime/harness";
import { expect, test } from "bun:test";

import type { Thread } from "@llm-space/core";

import {
  type ThreadRuntimeExecutionInput,
  ThreadRuntimeSession
} from "../../../../src/components/thread-playground/stores/thread-runtime-session";

test("retains and explicitly rejects old V4 Session bytes", async () => {
  const current = new ThreadRuntimeSession(undefined);
  const thread = _threadWithUser();
  const begun = await current.begin(_input(thread, "manual"));
  const legacy = structuredClone(begun.session) as unknown as {
    snapshot: { schemaVersion: number; };
  };
  legacy.snapshot.schemaVersion = 4;

  const reloaded = new ThreadRuntimeSession(legacy);

  expect(reloaded.loadError?.message).toContain("schema version");
  expect(legacy.snapshot.schemaVersion).toBe(4);
  expect(reloaded.begin(_input(thread, "manual")))
    .rejects.toThrow("Runtime Session metadata is invalid");
});

test("records a checkpoint for a Runtime-owned model-limit terminal", async () => {
  const thread = _threadWithUser();
  const input = {
    ..._input(thread, "react"),
    sessionLimits: { maxModelCallsPerRun: 1 }
  };
  const begun = await new ThreadRuntimeSession(undefined).begin(input);
  const store = new InMemorySessionStore([begun.session]);
  const operationId = `${begun.runId}:step:1:provider:fake`;
  const started = await store.commit({
    sessionId: begun.session.snapshot.id,
    expectedVersion: begun.session.version,
    mutations: [{
      type: "startOperation",
      runId: begun.runId,
      stepId: `${begun.runId}:step:1`,
      stepSequence: 1,
      transcriptMessageCount: 0,
      operationId,
      kind: "provider",
      provider: "fake",
      requestFingerprint: "a".repeat(64)
    }]
  });
  const terminal = await store.commit({
    sessionId: begun.session.snapshot.id,
    expectedVersion: started.version,
    mutations: [
      {
        type: "settleOperation",
        runId: begun.runId,
        operationId,
        requestFingerprint: "a".repeat(64),
        state: "completed",
        replay: {
          byteLength: 4,
          resultFingerprint: createHash("sha256").update("null").digest("hex"),
          value: null
        }
      },
      {
        type: "transitionRun",
        runId: begun.runId,
        to: "failed",
        failure: {
          axis: "modelCalls",
          attempted: 2,
          code: "runLimitExceeded",
          consumed: 1,
          limit: 1
        }
      }
    ]
  });

  const settled = await new ThreadRuntimeSession(terminal).settle({
    ...input,
    runId: begun.runId,
    sawEvent: true,
    outcome: "failed"
  });

  expect(settled.checkpoint?.state).toBe("failed");
  expect(settled.session.snapshot.runs[0]?.failure).toMatchObject({
    code: "runLimitExceeded",
    consumed: 1,
    limit: 1
  });
});

function _input(
  thread: Thread,
  executionMode: ThreadRuntimeExecutionInput["executionMode"]
): ThreadRuntimeExecutionInput {
  return {
    thread,
    context: thread.context ?? {},
    executionMode,
    model: thread.model!
  };
}

function _threadWithUser(): Thread {
  return {
    model: { provider: "fake", id: "model" },
    context: {
      systemPrompt: "Help",
      messages: [{
        id: "user-one",
        role: "user",
        content: [{ type: "text", text: "Hello" }]
      }]
    }
  };
}
