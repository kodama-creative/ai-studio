import { expect, test } from "bun:test";

import type { UpdateSessionNotification } from "@llm-space/acp/protocol";

import {
  createThreadStore,
  type AcpSessionExecutionRuntime,
} from "./thread-store";

test("ACP projection is the only execution transcript authority", async () => {
  let release: (() => void) | undefined;
  const commandStarted = new Promise<void>((resolve) => {
    release = resolve;
  });
  const prompts: unknown[] = [];
  const runtime: AcpSessionExecutionRuntime = {
    sessionId: "session-1",
    async *updates(): AsyncIterable<UpdateSessionNotification> {
      yield _notification(
        { sessionUpdate: "state_update", state: "idle" },
        0
      );
      await commandStarted;
      yield _notification(
        {
          sessionUpdate: "user_message",
          messageId: "user-1",
          content: [{ type: "text", text: "hello" }],
        },
        0
      );
      yield _notification(
        {
          sessionUpdate: "agent_message_chunk",
          messageId: "assistant-1",
          content: { type: "text", text: "partial" },
        },
        0
      );
      yield _notification(
        {
          sessionUpdate: "agent_message",
          messageId: "assistant-1",
          content: [{ type: "text", text: "committed" }],
          _meta: {
            "llm-space.dev": {
              usage: {
                input: 3,
                output: 2,
                cacheRead: 1,
                cacheWrite: 0,
                totalTokens: 6,
                cost: {
                  input: 0.01,
                  output: 0.02,
                  cacheRead: 0,
                  cacheWrite: 0,
                  total: 0.03,
                },
              },
            },
          },
        },
        1
      );
      yield _notification(
        {
          sessionUpdate: "state_update",
          state: "idle",
          stopReason: "end_turn",
        },
        2
      );
    },
    prompt(input) {
      prompts.push(input);
      release?.();
      return Promise.resolve();
    },
    step: () => Promise.resolve(),
    turn: () => Promise.resolve(),
    continue: () => Promise.resolve(),
    requestPermission: () => Promise.resolve(),
    cancel: () => Promise.resolve(),
  };
  const store = createThreadStore(
    {
      model: { provider: "test", id: "model" },
      context: {
        messages: [
          {
            id: "user-1",
            role: "user",
            content: [{ type: "text", text: "hello" }],
          },
        ],
      },
    },
    { executionRuntime: runtime }
  );
  let previousThread = store.getState().thread;
  let chunkKeptThreadStable = false;
  const unsubscribe = store.subscribe((state) => {
    if (state.streamingMessage?.content[0]?.text === "partial") {
      chunkKeptThreadStable = state.thread === previousThread;
    }
    previousThread = state.thread;
  });

  await store.getState().run("user-1");
  unsubscribe();

  expect(prompts).toHaveLength(1);
  expect(store.getState().acpSession?.cursor).toBe(2);
  expect(chunkKeptThreadStable).toBeTrue();
  expect(store.getState().thread.context?.messages).toEqual([
    {
      id: "user-1",
      role: "user",
      content: [{ type: "text", text: "hello" }],
    },
    {
      id: "assistant-1",
      role: "assistant",
      content: [{ type: "text", text: "committed" }],
      usage: {
        input: 3,
        output: 2,
        cacheRead: 1,
        cacheWrite: 0,
        totalTokens: 6,
        cost: {
          input: 0.01,
          output: 0.02,
          cacheRead: 0,
          cacheWrite: 0,
          total: 0.03,
        },
      },
    },
  ]);
});

function _notification(
  update: UpdateSessionNotification["update"],
  cursor: number
): UpdateSessionNotification {
  return {
    sessionId: "session-1",
    update,
    _meta: { "llm-space.dev": { cursor } },
  };
}
