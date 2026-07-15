import { describe, expect, test } from "bun:test";

import type { AgentEvent } from "@earendil-works/pi-agent-core";
import type { AssistantMessage } from "@earendil-works/pi-ai";

import { reduceMessages } from "./reducer";

describe("reduceMessages tool calls", () => {
  test("leaves a completed model tool request without a result", () => {
    const partial = _assistantMessage();
    const started = reduceMessages(
      { type: "message_start", message: partial },
      {}
    );
    if (!started) throw new Error("Expected message start");
    const toolCallStarted = reduceMessages(
      {
        type: "message_update",
        message: partial,
        assistantMessageEvent: {
          type: "toolcall_start",
          contentIndex: 0,
          partial,
        },
      },
      { streamingMessage: started.message, content: started.content }
    );
    if (!toolCallStarted) throw new Error("Expected tool call start");

    const toolCallEnded = reduceMessages(
      {
        type: "message_update",
        message: partial,
        assistantMessageEvent: {
          type: "toolcall_end",
          contentIndex: 0,
          toolCall: {
            type: "toolCall",
            id: "call-one",
            name: "fixture__remote_echo",
            arguments: {},
          },
          partial,
        },
      },
      {
        streamingMessage: toolCallStarted.message,
        content: toolCallStarted.content,
      }
    );

    expect(toolCallEnded?.message.toolCalls?.[0]).toEqual({
      id: "call-one",
      input: { name: "fixture__remote_echo", arguments: {} },
    });
  });
});

function _assistantMessage(): AssistantMessage {
  return {
    role: "assistant",
    content: [
      {
        type: "toolCall",
        id: "call-one",
        name: "fixture__remote_echo",
        arguments: {},
      },
    ],
    api: "openai-responses",
    provider: "openai",
    model: "gpt-test",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "toolUse",
    timestamp: 0,
  } satisfies Extract<AgentEvent, { type: "message_start" }>["message"];
}
