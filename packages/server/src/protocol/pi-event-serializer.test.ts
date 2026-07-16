import { describe, expect, test } from "bun:test";

import type { AgentEvent } from "@earendil-works/pi-agent-core";
import type { AssistantMessage } from "@earendil-works/pi-ai";

import { serializePiAgentEvent } from "./pi-event-serializer";

describe("Pi AgentEvent serializer", () => {
  test("publishes only known Pi fields and strips provider continuity data", () => {
    const message = {
      role: "assistant",
      content: [{
        type: "text",
        text: "hello",
        textSignature: "private-signature"
      }],
      api: "fake",
      provider: "fake",
      model: "fake-model",
      responseId: "private-response-id",
      providerMetadata: { private: true },
      usage: {
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
      },
      stopReason: "stop",
      timestamp: 1,
      unexpectedProviderField: "private-unknown"
    } as unknown as AssistantMessage;
    const event = {
      type: "message_update",
      message,
      assistantMessageEvent: {
        type: "start",
        partial: message,
        rawEvent: "private-raw-event"
      },
      unexpectedRootField: "private-root"
    } as unknown as AgentEvent;

    const serialized = serializePiAgentEvent(event);
    expect(serialized).toMatchObject({
      type: "message_update",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "hello" }],
        model: "fake-model",
        usage: { totalTokens: 2 }
      }
    });
    expect(JSON.stringify(serialized)).not.toContain("private-");
  });

  test("rejects cyclic and otherwise non-JSON tool payloads", () => {
    const args: Record<string, unknown> = {};
    args.self = args;
    expect(() => serializePiAgentEvent({
      type: "tool_execution_start",
      toolCallId: "call-1",
      toolName: "unsafe",
      args
    })).toThrow(TypeError);
    expect(() => serializePiAgentEvent({
      type: "tool_execution_start",
      toolCallId: "call-2",
      toolName: "unsafe",
      args: { missing: undefined }
    })).toThrow(TypeError);
    for (const [toolCallId, args] of [
      ["call-3", { value: new Date(0) }],
      ["call-4", { value: new Map([["key", "value"]]) }],
      ["call-5", { [Symbol("private")]: "value" }]
    ] as const) {
      expect(() => serializePiAgentEvent({
        type: "tool_execution_start",
        toolCallId,
        toolName: "unsafe",
        args
      })).toThrow(TypeError);
    }
  });
});
