import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { expect, test } from "bun:test";

import type { Message } from "../types/messages";

import { convertFromPiMessages } from "./from-pi-messages";

test("projects Pi tool results into the owning durable assistant message", () => {
  const existing: Message[] = [
    {
      id: "user-one",
      role: "user",
      content: [{ type: "text", text: "hello" }],
    },
  ];
  const messages: AgentMessage[] = [
    {
      role: "user",
      content: [{ type: "text", text: "hello" }],
      timestamp: 1,
    },
    {
      role: "assistant",
      content: [
        {
          type: "toolCall",
          id: "call-one",
          name: "echo",
          arguments: { text: "hello" },
        },
      ],
      api: "fake",
      provider: "fake",
      model: "fake",
      stopReason: "toolUse",
      usage: _usage(),
      timestamp: 2,
    },
    {
      role: "toolResult",
      toolCallId: "call-one",
      toolName: "echo",
      content: [{ type: "text", text: "echo:hello" }],
      isError: false,
      timestamp: 3,
    },
  ];

  const converted = convertFromPiMessages(messages, existing);

  expect(converted[0]?.id).toBe("user-one");
  expect(converted[1]).toMatchObject({
    role: "assistant",
    toolCalls: [
      {
        id: "call-one",
        input: { name: "echo", arguments: { text: "hello" } },
        output: { content: [{ type: "text", text: "echo:hello" }] },
      },
    ],
  });
});

function _usage() {
  return {
    input: 1,
    output: 1,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 2,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    },
  };
}
