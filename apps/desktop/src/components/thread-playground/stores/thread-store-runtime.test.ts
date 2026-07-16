import { describe, expect, mock, test } from "bun:test";

import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { AgentEvent, AgentTransport, Thread } from "@llm-space/core";
import type { StoredRuntimeSession } from "@llm-space/runtime/harness";

void mock.module("@/lib/electrobun", () => ({ electrobun: { rpc: null } }));
globalThis.requestAnimationFrame = callback =>
  setTimeout(() => { callback(performance.now()); }, 0) as unknown as number;
globalThis.cancelAnimationFrame = handle => {
  clearTimeout(handle);
};

describe("Thread store Runtime Harness integration", () => {
  test("persists a manual wait and reloads the same Run for prompt-free continuation", async () => {
    const { createThreadStore } = await import("./thread-store");
    let persisted: Thread = _initialThread();
    const first = createThreadStore(persisted, {
      transport: _transport(),
      resolveModel: saved => saved ?? null,
      getAutoRunTools: () => false,
      getReactLoop: () => false,
      runtimeOwnsToolLoop: true,
      persistSettledThread: async thread => {
        persisted = structuredClone(thread);
      }
    });

    await first.getState().run();

    const firstCheckpoint = persisted.runHistory?.[0];
    expect(firstCheckpoint?.runtime?.state).toBe("waitingForToolResults");
    expect(
      (persisted.runtimeSession as StoredRuntimeSession).snapshot.activeRunId
    ).toBe(firstCheckpoint?.runtime?.runId ?? null);

    const reloaded = createThreadStore(persisted, {
      transport: _transport(),
      resolveModel: saved => saved ?? null,
      getAutoRunTools: () => false,
      getReactLoop: () => false,
      runtimeOwnsToolLoop: true,
      persistSettledThread: async thread => {
        persisted = structuredClone(thread);
      }
    });
    const removableCheckpoint = reloaded.getState().runHistory[0];
    if (!removableCheckpoint) {
      throw new Error("Expected a removable Runtime checkpoint");
    }
    reloaded.getState().removeRun(removableCheckpoint);
    const assistantId = persisted.context?.messages?.find(
      message => message.role === "assistant"
    )?.id;
    if (!assistantId) {
      throw new Error("Expected a persisted assistant tool call");
    }
    reloaded.getState().updateToolCallOutputTextContent(
      assistantId,
      "call-one",
      "sunny"
    );
    await reloaded.getState().run();

    expect(persisted.runHistory).toHaveLength(1);
    expect(persisted.runHistory?.[0]?.runtime?.runId).toBe(
      firstCheckpoint?.runtime?.runId
    );
    expect(persisted.runHistory?.at(-1)?.runtime).toMatchObject({
      state: "completed",
      checkpointOrder: 2
    });
    expect(
      persisted.context?.messages?.filter(message => message.role === "user")
    ).toHaveLength(1);
    const session = persisted.runtimeSession as StoredRuntimeSession;
    expect(session.snapshot.runs).toHaveLength(1);
    expect(session.snapshot.runs[0]?.state).toBe("completed");
  });
});

function _initialThread(): Thread {
  return {
    model: { provider: "fake", id: "model" },
    context: {
      tools: [
        {
          type: "function" as const,
          name: "weather",
          description: "Get weather",
          parameters: { type: "object", properties: {} }
        }
      ],
      messages: [
        {
          id: "user-one",
          role: "user" as const,
          content: [{ type: "text" as const, text: "Weather?" }]
        }
      ]
    }
  };
}

function _transport(): AgentTransport {
  return async function* transport(
    request
  ): AsyncGenerator<AgentEvent> {
    const hasToolResult = request.context.messages.at(-1)?.role === "toolResult";
    const assistant = hasToolResult ? _finalAssistant() : _toolAssistant();
    yield { type: "message_start", message: assistant };
    if (!hasToolResult) {
      yield {
        type: "message_update",
        message: assistant,
        assistantMessageEvent: {
          type: "toolcall_start",
          contentIndex: 0,
          partial: assistant
        }
      };
      yield {
        type: "message_update",
        message: assistant,
        assistantMessageEvent: {
          type: "toolcall_end",
          contentIndex: 0,
          toolCall: {
            type: "toolCall",
            id: "call-one",
            name: "weather",
            arguments: {}
          },
          partial: assistant
        }
      };
    }
    yield { type: "message_end", message: assistant };
    yield { type: "agent_end", messages: [...request.context.messages, assistant] };
  };
}

function _toolAssistant(): AssistantMessage {
  return _assistant([
    {
      type: "toolCall",
      id: "call-one",
      name: "weather",
      arguments: {}
    }
  ], "toolUse");
}

function _finalAssistant(): AssistantMessage {
  return _assistant([{ type: "text", text: "Done" }], "stop");
}

function _assistant(
  content: AssistantMessage["content"],
  stopReason: AssistantMessage["stopReason"]
): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: "fake",
    provider: "fake",
    model: "model",
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
    },
    stopReason,
    timestamp: Date.now()
  };
}
