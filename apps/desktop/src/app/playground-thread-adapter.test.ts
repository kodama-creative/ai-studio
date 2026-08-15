import { expect, test } from "bun:test";

import type { AssistantMessage, Thread } from "@llm-space/core";
import type { PiSessionSnapshot } from "@llm-space/pi-runtime";
import type { Playground } from "@llm-space/studio";

import type { PlaygroundClient } from "@/client/playground-client";
import type { ThreadClient } from "@/shared/thread-rpc";

import {
  createPlaygroundThreadExecutionRuntime,
  playgroundToEditorThread,
} from "./playground-thread-adapter";

const USER_MESSAGE = {
  id: "user-1",
  role: "user" as const,
  content: [{ type: "text" as const, text: "hello" }],
};

test("Playground runtime starts and steps tools exclusively through Thread RPC", async () => {
  let playground = _playground();
  const calls: string[] = [];
  let toolCompleted = false;
  const client = _client({
    save: (_id, document) => {
      calls.push("metadata.save");
      playground = { ...playground, ...document, dirty: true };
      return Promise.resolve(playground);
    },
    load: () => {
      playground = {
        ...playground,
        ...(toolCompleted ? { operationId: undefined } : { operationId: "operation-1" }),
        dirty: false,
        conversation: {
          ...playground.conversation,
          messages: [USER_MESSAGE, _assistantWithTool(toolCompleted)],
        },
      };
      return Promise.resolve(playground);
    },
  });
  const threadClient = _threadClient({
    run: () => {
      calls.push("thread.run");
      playground = { ...playground, operationId: "operation-1" };
      return Promise.resolve({ sessionId: "session-1", operationId: "operation-1" });
    },
    inspect: () => {
      calls.push("thread.inspect");
      return Promise.resolve(_snapshot(toolCompleted ? "model" : "tool"));
    },
    step: () => {
      calls.push("thread.step");
      toolCompleted = true;
      return Promise.resolve({ sessionId: "session-1", operationId: "operation-1" });
    },
  });
  const runtime = createPlaygroundThreadExecutionRuntime({
    client,
    threadClient,
    playgroundId: playground.id,
    getPlayground: () => playground,
    onPlayground: (next) => {
      playground = next;
    },
  });

  const updates: Thread[] = [];
  for await (const event of runtime.execute({
    thread: playgroundToEditorThread(playground),
    fromMessageId: USER_MESSAGE.id,
    autoRunTools: true,
    reactLoop: false,
    signal: new AbortController().signal,
  })) {
    if (event.type === "thread.updated") updates.push(event.thread);
  }

  expect(calls).toEqual([
    "metadata.save",
    "thread.run",
    "thread.inspect",
    "thread.step",
  ]);
  expect(updates.at(-1)?.context?.messages?.at(-1)).toMatchObject({
    id: "assistant-1",
    toolCalls: [{ id: "call-1", output: { isError: false } }],
  });
});

test("Playground runtime resumes the current Pi action through Thread RPC", async () => {
  let playground = _playground({ operationId: "operation-1" });
  const calls: string[] = [];
  const runtime = createPlaygroundThreadExecutionRuntime({
    client: _client({ load: () => Promise.resolve(playground) }),
    threadClient: _threadClient({
      inspect: () => {
        calls.push("thread.inspect");
        return Promise.resolve(_snapshot("model"));
      },
      step: () => {
        calls.push("thread.step");
        playground = { ...playground, operationId: undefined };
        return Promise.resolve({ sessionId: "session-1", operationId: "operation-1" });
      },
    }),
    playgroundId: playground.id,
    getPlayground: () => playground,
    onPlayground: (next) => {
      playground = next;
    },
  });

  for await (const event of runtime.execute({
    thread: playgroundToEditorThread(playground),
    autoRunTools: false,
    reactLoop: false,
    signal: new AbortController().signal,
  })) {
    void event;
  }

  expect(calls).toEqual(["thread.inspect", "thread.step"]);
});

test("Playground runtime reports a Thread RPC execution failure", () => {
  let playground = _playground();
  const runtime = createPlaygroundThreadExecutionRuntime({
    client: _client({
      save: (_id, document) => {
        playground = { ...playground, ...document, dirty: true };
        return Promise.resolve(playground);
      },
    }),
    threadClient: _threadClient({
      run: () => Promise.reject(new Error("Model request failed.")),
    }),
    playgroundId: playground.id,
    getPlayground: () => playground,
    onPlayground: (next) => {
      playground = next;
    },
  });

  expect(
    (async () => {
      for await (const event of runtime.execute({
        thread: playgroundToEditorThread(playground),
        fromMessageId: USER_MESSAGE.id,
        autoRunTools: false,
        reactLoop: false,
        signal: new AbortController().signal,
      })) {
        void event;
      }
    })()
  ).rejects.toThrow("Model request failed.");
});

test("Playground runtime surfaces tool approval and resumes the same Pi operation", async () => {
  let playground = _playground({ operationId: "operation-1" });
  let approvalPending = false;
  const calls: string[] = [];
  const threadClient = _threadClient({
    inspect: () => {
      calls.push("thread.inspect");
      return Promise.resolve(
        approvalPending
          ? {
              ..._snapshot("tool"),
              status: "suspended",
              approval: {
                toolCallId: "call-1",
                toolName: "weather",
                status: "pending",
              },
            }
          : _snapshot("tool")
      );
    },
    step: () => {
      calls.push("thread.step");
      if (approvalPending) playground = { ...playground, operationId: undefined };
      else approvalPending = true;
      return Promise.resolve({ sessionId: "session-1", operationId: "operation-1" });
    },
    resolveToolApproval: (_target, _operationId, input) => {
      calls.push(`thread.approval:${input.approved}`);
      return Promise.resolve({ sessionId: "session-1", operationId: "operation-1" });
    },
  });
  const runtime = createPlaygroundThreadExecutionRuntime({
    client: _client({ load: () => Promise.resolve(playground) }),
    threadClient,
    playgroundId: playground.id,
    getPlayground: () => playground,
    onPlayground: (next) => {
      playground = next;
    },
  });

  const events = [];
  for await (const event of runtime.execute({
    thread: playgroundToEditorThread(playground),
    autoRunTools: false,
    reactLoop: false,
    signal: new AbortController().signal,
  })) {
    events.push(event);
  }
  expect(events.at(-1)).toEqual({
    type: "tool.approval.required",
    toolCallId: "call-1",
    toolName: "weather",
    resumeMode: "step",
  });

  for await (const event of runtime.resolveToolApproval!({
    thread: playgroundToEditorThread(playground),
    toolCallId: "call-1",
    approved: true,
    resumeMode: "step",
    signal: new AbortController().signal,
  })) {
    void event;
  }
  expect(calls).toEqual([
    "thread.inspect",
    "thread.step",
    "thread.inspect",
    "thread.approval:true",
    "thread.inspect",
    "thread.step",
  ]);
});

function _playground(overrides: Partial<Playground> = {}): Playground {
  return {
    schemaVersion: 1,
    id: "playground-1",
    title: "Example",
    sessionId: "session-1",
    lane: "main",
    leafId: null,
    runtimeFormatVersion: 1,
    agentSpec: {
      schemaVersion: 1,
      model: { provider: "test", id: "model" },
      instructions: ["Answer."],
      tools: [],
    },
    conversation: { messages: [USER_MESSAGE], state: { preserved: true } },
    dirty: false,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function _assistantWithTool(completed: boolean): AssistantMessage {
  return {
    id: "assistant-1",
    role: "assistant",
    content: [{ type: "text", text: "checking" }],
    toolCalls: [
      {
        id: "call-1",
        input: { name: "weather", arguments: {} },
        ...(completed ? { output: { content: [], isError: false } } : {}),
      },
    ],
  };
}

function _snapshot(kind: "model" | "tool"): PiSessionSnapshot {
  return {
    cursor: 1,
    sessionId: "session-1",
    lane: "main",
    operationId: "operation-1",
    status: "paused",
    messageEntries: [],
    messages: [],
    leafId: null,
    nextAction:
      kind === "model"
        ? { id: "action-model", kind, attempt: 1 }
        : {
            id: "action-tool",
            kind,
            assistantEntryId: "assistant-entry",
            toolIndex: 0,
            toolCallId: "call-1",
            toolName: "weather",
          },
  };
}

function _client(
  overrides: Partial<PlaygroundClient> = {}
): PlaygroundClient {
  return {
    list: () => Promise.resolve([]),
    create: () => Promise.reject(new Error("Unexpected create.")),
    load: () => Promise.resolve(_playground()),
    save: () => Promise.reject(new Error("Unexpected save.")),
    ...overrides,
  };
}

function _threadClient(
  overrides: Partial<ThreadClient> = {}
): ThreadClient {
  return {
    run: () => Promise.reject(new Error("Unexpected run.")),
    inspect: () => Promise.reject(new Error("Unexpected inspect.")),
    step: () => Promise.reject(new Error("Unexpected step.")),
    continue: () => Promise.reject(new Error("Unexpected continue.")),
    resolveToolApproval: () =>
      Promise.reject(new Error("Unexpected tool approval.")),
    cancel: () => Promise.resolve(),
    ...overrides,
  };
}
