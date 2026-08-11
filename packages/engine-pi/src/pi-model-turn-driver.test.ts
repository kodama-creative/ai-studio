import { expect, test } from "bun:test";

import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxThinking,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import type { ModelTurnEvent } from "@llm-space/engine";

import { createPiModelTurnDriver } from "./pi-model-turn-driver";

test("Pi driver translates text, thinking, tool calls, and finish metadata", async () => {
  const faux = fauxProvider({ tokensPerSecond: 0 });
  faux.setResponses([
    fauxAssistantMessage(
      [
        fauxThinking("Need a count"),
        { type: "text", text: "Checking " },
        fauxToolCall(
          "word_count",
          { text: "hello local agent" },
          { id: "call-1" }
        ),
      ],
      { stopReason: "toolUse" }
    ),
  ]);
  const models = createModels();
  models.setProvider(faux.provider);
  const driver = createPiModelTurnDriver({ models });

  const events = await _collect(
    driver.run(
      {
        agentId: "example",
        instructions: ["Count words with the tool."],
        messages: [
          {
            id: "user-1",
            role: "user",
            content: [{ type: "text", text: "Count these words" }],
          },
        ],
        model: `${faux.provider.id}/${faux.getModel().id}`,
        tools: [
          {
            name: "word_count",
            description: "Count words",
            inputSchema: {
              type: "object",
              properties: { text: { type: "string" } },
              required: ["text"],
            },
          },
        ],
      },
      { signal: new AbortController().signal }
    )
  );

  expect(events).toContainEqual({
    type: "thinking.delta",
    delta: "Need a count",
  });
  expect(events).toContainEqual({ type: "text.delta", delta: "Checking " });
  expect(events).toContainEqual({
    type: "tool.call",
    call: {
      id: "call-1",
      name: "word_count",
      arguments: { text: "hello local agent" },
    },
  });
  const finish = events.at(-1);
  expect(finish?.type).toBe("finish");
  if (finish?.type === "finish") {
    expect(finish.reason).toBe("tool-calls");
    expect(typeof finish.usage?.totalTokens).toBe("number");
  }
});

test("Pi driver expands core assistant tool outputs and preserves images", async () => {
  const faux = fauxProvider({ tokensPerSecond: 0 });
  let observedMessages: unknown;
  faux.setResponses([
    (context) => {
      observedMessages = context.messages;
      return fauxAssistantMessage("received");
    },
  ]);
  const models = createModels();
  models.setProvider(faux.provider);
  const driver = createPiModelTurnDriver({ models });

  await _collect(
    driver.run(
      {
        agentId: "example",
        instructions: [],
        messages: [
          {
            id: "user-1",
            role: "user",
            content: [
              { type: "text", text: "Inspect it" },
              { type: "image", data: "dXNlcg==", mimeType: "image/png" },
            ],
          },
          {
            id: "assistant-1",
            role: "assistant",
            content: [],
            toolCalls: [
              {
                id: "call-1",
                input: { name: "image", arguments: {} },
                output: {
                  content: [
                    { type: "image", data: "dG9vbA==", mimeType: "image/png" },
                  ],
                  isError: false,
                },
              },
            ],
          },
        ],
        model: `${faux.provider.id}/${faux.getModel().id}`,
        tools: [],
      },
      { signal: new AbortController().signal }
    )
  );

  expect(observedMessages).toEqual([
    {
      role: "user",
      content: [
        { type: "text", text: "Inspect it" },
        { type: "image", data: "dXNlcg==", mimeType: "image/png" },
      ],
      timestamp: 0,
    },
    expect.objectContaining({
      role: "assistant",
      content: [
        { type: "toolCall", id: "call-1", name: "image", arguments: {} },
      ],
    }),
    {
      role: "toolResult",
      toolCallId: "call-1",
      toolName: "image",
      content: [{ type: "image", data: "dG9vbA==", mimeType: "image/png" }],
      details: {
        content: [{ type: "image", data: "dG9vbA==", mimeType: "image/png" }],
        isError: false,
      },
      isError: false,
      timestamp: 0,
    },
  ]);
});

async function _collect(
  values: AsyncIterable<ModelTurnEvent>
): Promise<ModelTurnEvent[]> {
  const result: ModelTurnEvent[] = [];
  for await (const value of values) result.push(value);
  return result;
}
