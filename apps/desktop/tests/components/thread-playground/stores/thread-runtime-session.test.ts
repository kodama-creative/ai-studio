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
