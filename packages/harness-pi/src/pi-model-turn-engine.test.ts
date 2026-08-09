import { expect, test } from "bun:test";

import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import type { ModelTurnEvent } from "@llm-space/harness";

import { createPiModelTurnEngine } from "./index";

async function _collect(
  values: AsyncIterable<ModelTurnEvent>
): Promise<ModelTurnEvent[]> {
  const result: ModelTurnEvent[] = [];
  for await (const value of values) result.push(value);
  return result;
}

test("Pi model turn engine translates streamed text and tool calls", async () => {
  const faux = fauxProvider({ tokensPerSecond: 0 });
  faux.setResponses([
    fauxAssistantMessage(
      [
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
  const engine = createPiModelTurnEngine({ models });

  const events = await _collect(
    engine.run(
      {
        agentId: "example",
        instructions: ["Count words with the tool."],
        messages: [
          { id: "user-1", role: "user", content: "Count these words" },
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

  expect(events).toEqual([
    { type: "text.delta", delta: "Checking " },
    {
      type: "tool.call",
      call: {
        id: "call-1",
        name: "word_count",
        input: { text: "hello local agent" },
      },
    },
    { type: "finish", reason: "tool-calls" },
  ]);
});

test("Pi model turn engine preserves image tool results for the next step", async () => {
  const faux = fauxProvider({ tokensPerSecond: 0 });
  let observedToolContent: unknown;
  faux.setResponses([
    (context) => {
      const last = context.messages.at(-1);
      observedToolContent = last?.role === "toolResult" ? last.content : null;
      return fauxAssistantMessage("received");
    },
  ]);
  const models = createModels();
  models.setProvider(faux.provider);
  const engine = createPiModelTurnEngine({ models });

  await _collect(
    engine.run(
      {
        agentId: "example",
        instructions: [],
        messages: [
          { id: "user-1", role: "user", content: "Inspect it" },
          {
            id: "assistant-1",
            role: "assistant",
            content: "",
            toolCalls: [{ id: "call-1", name: "image", input: {} }],
          },
          {
            id: "tool-1",
            role: "tool",
            callId: "call-1",
            name: "image",
            output: {
              type: "content",
              value: [
                {
                  type: "file",
                  data: { type: "data", data: "aW1hZ2U=" },
                  mediaType: "image/png",
                  filename: "image.png",
                },
              ],
            },
            isError: false,
          },
        ],
        model: `${faux.provider.id}/${faux.getModel().id}`,
        tools: [],
      },
      { signal: new AbortController().signal }
    )
  );

  expect(observedToolContent).toEqual([
    { type: "image", data: "aW1hZ2U=", mimeType: "image/png" },
  ]);
});
