import { expect, test } from "bun:test";

import {
  messagesFromSharedSessionUpdates,
  parseSharedDocument,
  sharedSessionUpdatesFromMessages,
  threadFromSharedDocument,
} from "./thread-snapshot";

test("Shared Document rejects every legacy Thread snapshot", () => {
  expect(() =>
    parseSharedDocument({
      kind: "llm-space.thread-snapshot",
      schemaVersion: 1,
      source: { sessionId: "secret" },
      thread: {},
    })
  ).toThrow();
});

test("Shared Document contains committed ACP upserts and no runtime identity", () => {
  const document = parseSharedDocument({
    kind: "llm-space.shared-document",
    version: 1,
    document: {
      title: "Shared",
      instructions: ["Be useful"],
      model: { provider: "test", id: "model" },
      tools: [],
    },
    conversation: {
      updates: [
        {
          sessionUpdate: "user_message",
          messageId: "user-1",
          content: [{ type: "text", text: "hello" }],
        },
        {
          sessionUpdate: "agent_message",
          messageId: "assistant-1",
          content: [{ type: "text", text: "hi" }],
        },
      ],
    },
  });

  expect(JSON.stringify(document)).not.toContain("sessionId");
  expect(threadFromSharedDocument(document).context?.messages).toHaveLength(2);
});

test("Shared Document rejects ephemeral chunks", () => {
  expect(() =>
    parseSharedDocument({
      kind: "llm-space.shared-document",
      version: 1,
      document: { title: "x", instructions: [], tools: [] },
      conversation: {
        updates: [
          {
            sessionUpdate: "agent_message_chunk",
            messageId: "assistant-1",
            content: { type: "text", text: "partial" },
          },
        ],
      },
    })
  ).toThrow();
});

test("Shared Document rejects malformed committed upserts", () => {
  expect(() =>
    parseSharedDocument({
      kind: "llm-space.shared-document",
      version: 1,
      document: { title: "x", instructions: [], tools: [] },
      conversation: {
        updates: [{ sessionUpdate: "agent_message", content: [] }],
      },
    })
  ).toThrow();
});

test("committed ACP agent messages reject malformed model usage metadata", () => {
  expect(() =>
    messagesFromSharedSessionUpdates([
      {
        sessionUpdate: "agent_message",
        messageId: "assistant-1",
        content: [{ type: "text", text: "answer" }],
        _meta: {
          "llm-space.dev": {
            usage: { input: -1 },
          },
        },
      },
    ])
  ).toThrow("invalid model usage");
});

test("committed ACP upserts round-trip editor messages and tool results", () => {
  const messages = [
    {
      id: "user-1",
      role: "user" as const,
      content: [{ type: "text" as const, text: "run" }],
    },
    {
      id: "assistant-1",
      role: "assistant" as const,
      content: [{ type: "text" as const, text: "done" }],
      thinking: "inspect",
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
      toolCalls: [
        {
          id: "call-1",
          input: { name: "read", arguments: { path: "README.md" } },
          output: {
            content: [{ type: "text" as const, text: "contents" }],
          },
        },
      ],
    },
  ];
  expect(
    messagesFromSharedSessionUpdates(sharedSessionUpdatesFromMessages(messages))
  ).toEqual(messages);
});
