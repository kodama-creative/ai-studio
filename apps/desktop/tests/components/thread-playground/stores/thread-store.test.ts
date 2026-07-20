import { expect, mock, test } from "bun:test";

import type { Thread } from "@llm-space/core";

void mock.module("@/lib/electrobun", () => ({ electrobun: { rpc: null } }));

const INVALID_THREAD: Thread = {
  model: { provider: "fake", id: "model" },
  context: {
    messages: [
      {
        id: "user-one",
        role: "user",
        content: [{ type: "text", text: "Question" }]
      },
      {
        id: "assistant-one",
        role: "assistant",
        content: [{ type: "text", text: "Answer" }]
      }
    ]
  }
};

test("scopes invalid Run feedback to the blocking message", async () => {
  const { createThreadStore } = await import(
    "@/components/thread-playground/stores"
  );
  let transportCalls = 0;
  const store = createThreadStore(INVALID_THREAD, {
    transport: () => {
      transportCalls += 1;
      throw new Error("Transport should not run for invalid input");
    },
    resolveModel: saved => saved ?? null
  });

  await store.getState().run();

  expect(store.getState().runValidationIssue).toMatchObject({
    code: "lastAssistantMessage",
    level: "warning",
    messageId: "assistant-one",
    resolution: { type: "appendUserMessage" }
  });
  expect(transportCalls).toBe(0);

  store.getState().updateMessageTextContent("assistant-one", "Edited answer");
  expect(store.getState().runValidationIssue?.messageId).toBe("assistant-one");

  store.getState().resolveRunValidationIssue();
  expect(store.getState().runValidationIssue).toBeNull();
  expect(store.getState().thread.context?.messages?.at(-1)?.role).toBe("user");
  expect(store.getState().autoFocusMessageId).toBe(
    store.getState().thread.context?.messages?.at(-1)?.id ?? null
  );
});

test("clears invalid Run feedback when the blocking role becomes runnable", async () => {
  const { createThreadStore } = await import(
    "@/components/thread-playground/stores"
  );
  const store = createThreadStore(INVALID_THREAD, {
    transport: () => {
      throw new Error("Transport should not run for invalid input");
    },
    resolveModel: saved => saved ?? null
  });

  await store.getState().run();
  store.getState().toggleMessageRole("assistant-one");

  expect(store.getState().runValidationIssue).toBeNull();
});
