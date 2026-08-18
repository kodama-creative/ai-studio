import { describe, expect, test } from "bun:test";

import {
  createAcpSessionProjection,
  reduceAcpSessionNotification,
  reduceAcpSessionUpdate,
} from "./projection";

describe("ACP session projection", () => {
  test("committed message upsert replaces ephemeral chunks with the same id", () => {
    const initial = createAcpSessionProjection("session-1");
    const chunked = reduceAcpSessionUpdate(initial, {
      sessionUpdate: "agent_message_chunk",
      messageId: "assistant-1",
      content: { type: "text", text: "Hel" },
    });
    const committed = reduceAcpSessionUpdate(chunked, {
      sessionUpdate: "agent_message",
      messageId: "assistant-1",
      content: [{ type: "text", text: "Hello" }],
    });

    expect(committed.messageOrder).toEqual(["assistant-1"]);
    expect(committed.messages["assistant-1"]?.content).toEqual([
      { type: "text", text: "Hello" },
    ]);
  });

  test("tool calls are patch-upserted and committed cursor never moves backwards", () => {
    const initial = reduceAcpSessionUpdate(
      createAcpSessionProjection("session-1"),
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "call-1",
        name: "read",
        status: "pending",
        rawInput: { path: "README.md" },
      }
    );
    const completed = reduceAcpSessionNotification(initial, {
      sessionId: "session-1",
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId: "call-1",
        status: "completed",
      },
      _meta: { "llm-space.dev": { cursor: 9 } },
    });
    const replayed = reduceAcpSessionNotification(completed, {
      sessionId: "session-1",
      update: { sessionUpdate: "state_update", state: "idle" },
      _meta: { "llm-space.dev": { cursor: 4 } },
    });

    expect(replayed.toolCallOrder).toEqual(["call-1"]);
    expect(replayed.toolCalls["call-1"]).toMatchObject({
      name: "read",
      status: "completed",
      rawInput: { path: "README.md" },
    });
    expect(replayed.cursor).toBe(9);
  });

  test("usage records aggregate idempotently across replay", () => {
    const initial = createAcpSessionProjection("session-1");
    const first = reduceAcpSessionUpdate(initial, {
      sessionUpdate: "usage_update",
      used: 3,
      size: 3,
      cost: { amount: 0.01, currency: "USD" },
      _meta: { "llm-space.dev": { usageRecordId: "usage-1" } },
    });
    const replayed = reduceAcpSessionUpdate(first, {
      sessionUpdate: "usage_update",
      used: 3,
      size: 3,
      cost: { amount: 0.01, currency: "USD" },
      _meta: { "llm-space.dev": { usageRecordId: "usage-1" } },
    });
    const second = reduceAcpSessionUpdate(replayed, {
      sessionUpdate: "usage_update",
      used: 2,
      size: 2,
      cost: { amount: 0.02, currency: "USD" },
      _meta: { "llm-space.dev": { usageRecordId: "usage-2" } },
    });

    expect(second.usage).toEqual({
      used: 5,
      size: 5,
      cost: { amount: 0.03, currency: "USD" },
    });
    expect(Object.keys(second.usageRecords)).toHaveLength(2);
  });
});
