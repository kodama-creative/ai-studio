import { expect, test } from "bun:test";

import type { ToolContext } from "@llm-space/agent/tools";

import type { ModelTurnEngine } from "./model-engine";
import { createModelRunExecutor } from "./run-executor";

test("RunExecutor represents a model/tool loop entirely through messages", async () => {
  let modelCall = 0;
  const engine: ModelTurnEngine = {
    async *run() {
      await Promise.resolve();
      modelCall += 1;
      if (modelCall === 1) {
        yield {
          type: "tool.call",
          call: { id: "call-1", name: "greet", input: { name: "Ada" } },
        };
        yield { type: "finish", reason: "tool-calls" };
      } else {
        yield { type: "text.delta", delta: "Hello Ada" };
        yield { type: "finish", reason: "stop" };
      }
    },
  };
  const context = {
    abortSignal: new AbortController().signal,
    callId: "call-1",
    toolName: "greet",
    session: {
      id: "studio:thread-1",
      auth: { current: null, initiator: null },
      turn: { id: "run-1", sequence: 1 },
    },
    getSandbox: () => Promise.reject(new Error("unused")),
    getSkill: () => {
      throw new Error("unused");
    },
    getToken: () => Promise.reject(new Error("unused")),
    requireAuth: () => {
      throw new Error("unused");
    },
  } satisfies ToolContext;
  const executor = createModelRunExecutor({
    engine,
    generateId: (() => {
      const ids = ["assistant-1", "assistant-2"];
      return () => ids.shift()!;
    })(),
    createToolContext: () => context,
  });

  const events = [];
  for await (const event of executor.execute(
    {
      runId: "run-1",
      owner: { type: "thread", threadId: "thread-1" },
      agent: {
        snapshot: {
          schemaVersion: 1,
          agentId: "agent",
          generationId: "generation",
          model: "openai/gpt-5",
          instructions: [],
          tools: [{ name: "greet", description: "Greet", inputSchema: {} }],
        },
        tools: new Map([
          [
            "greet",
            {
              model: { name: "greet", description: "Greet", inputSchema: {} },
              definition: {
                description: "Greet",
                inputSchema: {},
                execute: ({ name }: Record<string, unknown>) =>
                  `Hi ${String(name)}`,
              },
            },
          ],
        ]),
      },
      conversation: {
        messages: [
          {
            id: "user-1",
            role: "user",
            content: [{ type: "text", text: "Say hello" }],
          },
        ],
        state: {},
      },
    },
    { signal: new AbortController().signal }
  )) {
    events.push(event);
  }

  expect(events.map((event) => event.type)).toEqual([
    "message.completed",
    "tool.started",
    "tool.completed",
    "message.delta",
    "message.completed",
  ]);
  expect(events).not.toContainEqual(expect.objectContaining({ type: "step" }));
  expect(events[2]).toEqual({
    type: "tool.completed",
    messageId: "assistant-1",
    toolCallId: "call-1",
    result: {
      output: { type: "text", value: "Hi Ada" },
      isError: false,
    },
  });
});
