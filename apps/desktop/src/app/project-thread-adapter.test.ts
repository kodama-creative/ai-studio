import { expect, test } from "bun:test";

import type { StudioThread } from "@llm-space/harness/studio";

import {
  playgroundThreadToStudioEvaluationMetadata,
  studioThreadToPlaygroundThread,
} from "./project-thread-adapter";

test("Studio Thread messages and tool results map into the existing Playground model", () => {
  const thread: StudioThread = {
    schemaVersion: 1,
    id: "thread-1",
    document: {
      title: "Example",
      commitId: "commit-a",
      agent: {
        schemaVersion: 1,
        agentId: "agent",
        generationId: "generation",
        model: "openai/gpt-5",
        instructions: ["First", "Second"],
        tools: [{ name: "lookup", description: "Lookup", inputSchema: {} }],
      },
      conversation: {
        state: {},
        messages: [
          {
            id: "assistant-1",
            role: "assistant",
            content: [{ type: "text", text: "Checking" }],
            toolCalls: [
              {
                id: "call-1",
                name: "lookup",
                input: { q: "Ada" },
                result: {
                  output: { type: "json", value: { answer: 42 } },
                  isError: false,
                },
              },
            ],
          },
        ],
      },
    },
    createdAt: 1,
    updatedAt: 1,
  };

  expect(studioThreadToPlaygroundThread(thread)).toEqual({
    title: "Example",
    model: { provider: "openai", id: "gpt-5" },
    context: {
      systemPrompt: "First\n\nSecond",
      tools: [
        {
          type: "function",
          name: "lookup",
          description: "Lookup",
          parameters: {},
        },
      ],
      messages: [
        {
          id: "assistant-1",
          role: "assistant",
          content: [{ type: "text", text: "Checking" }],
          toolCalls: [
            {
              id: "call-1",
              input: { name: "lookup", arguments: { q: "Ada" } },
              output: {
                content: [{ type: "text", text: '{"answer":42}' }],
                isError: false,
              },
            },
          ],
        },
      ],
    },
  });
});

test("Studio Evaluation resources map to Playground metadata without entering the Thread document", () => {
  const thread: StudioThread = {
    schemaVersion: 1,
    id: "thread-1",
    document: {
      title: "Example",
      commitId: "commit-a",
      agent: {
        schemaVersion: 1,
        agentId: "agent",
        generationId: "generation",
        model: "openai/gpt-5",
        instructions: [],
        tools: [],
      },
      conversation: { messages: [], state: {} },
    },
    createdAt: 1,
    updatedAt: 1,
  };
  const playground = studioThreadToPlaygroundThread(thread, [], {
    evaluations: [
      {
        schemaVersion: 1,
        id: "evaluation-1",
        threadId: thread.id,
        leftRunId: "run-1",
        rightRunId: "run-2",
        verdict: "tie",
        createdAt: 2,
        updatedAt: 2,
      },
    ],
    rubrics: [],
  });

  expect(playground.evaluations).toEqual([
    {
      id: "evaluation-1",
      leftRunId: "run-1",
      rightRunId: "run-2",
      verdict: "tie",
      createdAt: 2,
      updatedAt: 2,
    },
  ]);
  expect(playgroundThreadToStudioEvaluationMetadata(playground)).toEqual({
    evaluations: playground.evaluations ?? [],
    rubrics: [],
  });
  expect(thread.document).not.toHaveProperty("evaluations");
});
