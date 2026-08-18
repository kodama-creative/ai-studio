import { describe, expect, test } from "bun:test";

import type { ProviderHostedTool, Thread } from "@llm-space/core";

import { createThreadStore } from "../../../../src/components/thread-playground/stores";

const INVALID_THREAD: Thread = {
  context: {
    messages: [
      {
        content: [{ text: "Question", type: "text" }],
        id: "user-one",
        role: "user",
      },
      {
        content: [{ text: "Answer", type: "text" }],
        id: "assistant-one",
        role: "assistant",
      },
    ],
  },
  model: { id: "model", provider: "fake" },
};

describe("inline run validation", () => {
  test("scopes feedback to the blocking message", async () => {
    const store = createThreadStore(INVALID_THREAD, {
      resolveModel: (saved) => saved ?? null,
    });

    await store.getState().run();

    expect(store.getState().runValidationIssue).toMatchObject({
      code: "lastAssistantMessage",
      level: "warning",
      messageId: "assistant-one",
      resolution: { type: "appendUserMessage" },
    });

    store.getState().updateMessageTextContent("assistant-one", "Edited answer");
    expect(store.getState().runValidationIssue?.messageId).toBe(
      "assistant-one"
    );

    store.getState().resolveRunValidationIssue();
    const messages = store.getState().thread.context?.messages ?? [];
    expect(store.getState().runValidationIssue).toBeNull();
    expect(messages.at(-1)?.role).toBe("user");
    expect(store.getState().autoFocusMessageId).toBe(
      messages.at(-1)?.id ?? null
    );
  });

  test("clears feedback when the blocking role becomes runnable", async () => {
    const store = createThreadStore(INVALID_THREAD, {
      resolveModel: (saved) => saved ?? null,
    });

    await store.getState().run();
    store.getState().toggleMessageRole("assistant-one");

    expect(store.getState().runValidationIssue).toBeNull();
  });
});

describe("provider-hosted tools", () => {
  const providerHostedTool: ProviderHostedTool = {
    type: "provider-hosted",
    config: { type: "web_search", search_context_size: "high" },
  };

  test("uses provider-hosted identity for add, duplicate, update, and removal", () => {
    const store = createThreadStore({});

    expect(store.getState().addTool(providerHostedTool)).toBe(true);
    expect(store.getState().addTool(providerHostedTool)).toBe(false);
    expect(
      store.getState().addTool({
        type: "function",
        name: "web_search",
        description: "Client function",
        parameters: { type: "object" },
      })
    ).toBe(true);
    expect(
      store.getState().updateTool("provider-hosted:web_search", {
        type: "provider-hosted",
        config: { type: "file_search", vector_store_ids: ["vs_1"] },
      })
    ).toBe(true);

    expect(store.getState().thread.context?.tools).toHaveLength(2);
    store.getState().removeTool("provider-hosted:file_search");
    expect(store.getState().thread.context?.tools).toEqual([
      expect.objectContaining({ type: "function", name: "web_search" }),
    ]);
  });

});
