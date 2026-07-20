import { expect, test } from "bun:test";

import type { AgentMessage } from "@earendil-works/pi-agent-core";

import { convertFromPiMessages } from "./from-pi-messages";

import type { Message } from "../types/messages";

test("projects Pi tool results into the owning durable assistant message", () => {
  const existing: Message[] = [
    {
      id: "user-one",
      role: "user",
      content: [{ type: "text", text: "hello" }]
    }
  ];
  const messages: AgentMessage[] = [
    {
      role: "user",
      content: [{ type: "text", text: "hello" }],
      timestamp: 1
    },
    {
      role: "assistant",
      content: [
        {
          type: "toolCall",
          id: "call-one",
          name: "echo",
          arguments: { text: "hello" }
        }
      ],
      api: "fake",
      provider: "fake",
      model: "fake",
      stopReason: "toolUse",
      usage: _usage(),
      timestamp: 2
    },
    {
      role: "toolResult",
      toolCallId: "call-one",
      toolName: "echo",
      content: [{ type: "text", text: "echo:hello" }],
      isError: false,
      timestamp: 3
    }
  ];

  const converted = convertFromPiMessages(messages, existing);

  expect(converted[0]?.id).toBe("user-one");
  expect(converted[1]).toMatchObject({
    role: "assistant",
    toolCalls: [
      {
        id: "call-one",
        input: { name: "echo", arguments: { text: "hello" } },
        output: { content: [{ type: "text", text: "echo:hello" }] }
      }
    ]
  });
});

test("keeps attachment descriptors without persisting generated Pi text", () => {
  const existing: Message[] = [{
    id: "user-one",
    role: "user",
    content: [{ type: "text", text: "inspect" }],
    attachments: [{
      id: "attachment-one",
      name: "notes.txt",
      path: "/workspace/attachments/batch/notes.txt",
      size: 5,
      fingerprint: "a".repeat(64)
    }]
  }];
  const converted = convertFromPiMessages([{
    role: "user",
    content: [
      { type: "text", text: "inspect" },
      {
        type: "text",
        text:
          "<attachments>\n- notes.txt: /workspace/attachments/batch/notes.txt\n</attachments>"
      }
    ],
    timestamp: 1
  }], existing);

  expect(converted).toEqual(existing);
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
      total: 0
    }
  };
}
