import { expect, test } from "bun:test";

import type { Thread } from "@llm-space/core";

import {
  createThreadStore,
  type ExternalThreadExecutionRuntime,
} from "./thread-store";

test("Thread store delegates a full run to an external interaction runtime", async () => {
  const initial: Thread = {
    model: { provider: "test", id: "model" },
    context: {
      messages: [
        {
          id: "user-1",
          role: "user",
          content: [{ type: "text", text: "hello" }],
        },
      ],
    },
  };
  let received: Thread | undefined;
  const executionRuntime: ExternalThreadExecutionRuntime = {
    async *execute(input) {
      received = input.thread;
      yield {
        type: "thread.updated",
        thread: {
          ...input.thread,
          context: {
            ...input.thread.context,
            messages: [
              ...(input.thread.context?.messages ?? []),
              {
                id: "assistant-1",
                role: "assistant",
                content: [{ type: "text", text: "world" }],
              },
            ],
          },
        },
      };
    },
    async *executeToolCall() {
      await Promise.resolve();
    },
  };
  const store = createThreadStore(initial, { executionRuntime });

  await store.getState().run("user-1");

  expect(received?.context?.messages).toEqual(initial.context?.messages);
  expect(store.getState().thread.context?.messages).toHaveLength(2);
  expect(store.getState().runHistory).toEqual([]);
  expect(store.getState().status).toBe("idle");
  expect(store.getState().externalToolExecutionAvailable).toBeTrue();
});

test("Thread store resolves the displayed fallback model before an external run", async () => {
  const fallback = { provider: "test", id: "fallback-model" };
  const initial: Thread = {
    context: {
      messages: [
        {
          id: "user-1",
          role: "user",
          content: [{ type: "text", text: "hello" }],
        },
      ],
    },
  };
  let received: Thread | undefined;
  const executionRuntime: ExternalThreadExecutionRuntime = {
    async *execute(input) {
      received = input.thread;
    },
  };
  const store = createThreadStore(initial, {
    executionRuntime,
    resolveModel: (saved) => saved ?? fallback,
  });

  await store.getState().run("user-1");

  expect(received?.model).toEqual(fallback);
});

test("Thread store tracks host-owned Tool lifecycle events", async () => {
  const observedExecuting: string[][] = [];
  const executionRuntime: ExternalThreadExecutionRuntime = {
    async *execute() {
      yield { type: "tool.started", toolCallId: "call-1" };
      yield { type: "tool.completed", toolCallId: "call-1" };
    },
  };
  const store = createThreadStore(
    {
      context: {
        messages: [
          {
            id: "user-1",
            role: "user",
            content: [{ type: "text", text: "hello" }],
          },
        ],
      },
    },
    { executionRuntime }
  );
  const unsubscribe = store.subscribe((state, previous) => {
    if (
      state.executingToolCallIds.join(",") !==
      previous.executingToolCallIds.join(",")
    ) {
      observedExecuting.push(state.executingToolCallIds);
    }
  });

  await store.getState().run("user-1");
  unsubscribe();

  expect(observedExecuting).toContainEqual(["call-1"]);
  expect(store.getState().executingToolCallIds).toEqual([]);
});

test("Thread store publishes durable metadata edits through the host seam", () => {
  const runThread: Thread = { context: { messages: [] } };
  const initial: Thread = {
    context: { messages: [] },
    runHistory: [
      { id: "run-1", thread: runThread, timestamp: 1 },
      { id: "run-2", thread: runThread, timestamp: 2 },
    ],
    evaluations: [
      {
        id: "evaluation-1",
        leftRunId: "run-1",
        rightRunId: "run-2",
        verdict: "tie",
        createdAt: 3,
        updatedAt: 3,
      },
    ],
  };
  const changes: unknown[] = [];
  const store = createThreadStore(initial, {
    onRunMetadataChange: (metadata) => changes.push(metadata),
  });

  store.getState().removeRun(store.getState().runHistory[1]!);

  expect(changes).toEqual([
    {
      runHistory: [expect.objectContaining({ id: "run-1" })],
      evaluations: [],
      evaluationRubrics: [],
    },
  ]);
});
