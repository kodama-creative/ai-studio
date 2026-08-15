import { expect, test } from "bun:test";

import type { Thread } from "@llm-space/core";

import { createThreadStore } from "./stores";
import { subscribeThreadPlaygroundEvents } from "./thread-playground-events";

const INITIAL: Thread = {
  title: "Experiment",
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

test("runtime-owned run updates do not save a Draft for an active Studio operation", async () => {
  const runtimeThread: Thread = {
    ...INITIAL,
    context: {
      messages: [
        ...INITIAL.context!.messages!,
        {
          id: "assistant-1",
          role: "assistant",
          content: [{ type: "text", text: "paused after one step" }],
        },
      ],
    },
  };
  const store = createThreadStore(INITIAL, {
    executionRuntime: {
      async *execute() {
        yield { type: "thread.updated", thread: runtimeThread };
      },
    },
  });
  const unsubscribe = subscribeThreadPlaygroundEvents(
    store,
    {
      onChange() {
        throw new Error(
          'Studio Thread "experiment-1" has an active operation.'
        );
      },
    },
    { runChangePersistence: "runtime" }
  );

  try {
    await expect(store.getState().run("user-1")).resolves.toBeUndefined();
    expect(store.getState().thread).toEqual(runtimeThread);
  } finally {
    unsubscribe();
  }
});

test("editor-owned run updates still flush through onChange", async () => {
  const runtimeThread = { ...INITIAL, title: "Completed locally" };
  const store = createThreadStore(INITIAL, {
    executionRuntime: {
      async *execute() {
        yield { type: "thread.updated", thread: runtimeThread };
      },
    },
  });
  const changes: Thread[] = [];
  const unsubscribe = subscribeThreadPlaygroundEvents(store, {
    onChange(thread) {
      changes.push(thread);
    },
  });

  try {
    await store.getState().run("user-1");

    expect(changes).toEqual([runtimeThread]);
  } finally {
    unsubscribe();
  }
});
