import { expect, test } from "bun:test";

import {
  LLM_SPACE_ACP_METHODS,
  methods,
  type ClientConnection,
  type PiAcpDebugResponse,
  type UpdateSessionNotification,
} from "@llm-space/acp";
import type { AssistantMessage, Thread } from "@llm-space/core";
import type { Playground } from "@llm-space/studio";

import type { PlaygroundClient } from "@/client/playground-client";

import {
  createPlaygroundThreadExecutionRuntime,
  playgroundToEditorThread,
} from "./playground-thread-adapter";

const USER_MESSAGE = {
  id: "user-1",
  role: "user" as const,
  content: [{ type: "text" as const, text: "hello" }],
};

test("Playground runtime starts and steps tools exclusively through ACP", async () => {
  let playground = _playground();
  const calls: string[] = [];
  let toolCompleted = false;
  const client = _client({
    save: (_id, document) => {
      calls.push("metadata.save");
      playground = {
        ...playground,
        ...document,
        dirty: true,
      };
      return Promise.resolve(playground);
    },
    load: () => {
      playground = {
        ...playground,
        operationId: toolCompleted ? "operation-1" : undefined,
        dirty: false,
        conversation: {
          ...playground.conversation,
          messages: [USER_MESSAGE, _assistantWithTool(toolCompleted)],
        },
      };
      return Promise.resolve(playground);
    },
  });
  const runtime = createPlaygroundThreadExecutionRuntime({
    client,
    playgroundId: playground.id,
    getPlayground: () => playground,
    onPlayground: (next) => {
      playground = next;
    },
    openAcpConnection: ({ onSessionUpdate }) =>
      Promise.resolve(
        _connection((method) => {
          calls.push(method);
          if (method === methods.agent.session.prompt) {
            playground = { ...playground, operationId: "operation-1" };
            onSessionUpdate?.(_stoppedUpdate(playground.sessionId));
            return { _meta: { "llm-space.dev": { accepted: true } } };
          }
          if (method === LLM_SPACE_ACP_METHODS.snapshot) {
            return _debug(toolCompleted ? "model" : "tool");
          }
          if (method === LLM_SPACE_ACP_METHODS.step) {
            toolCompleted = true;
            return _debug("model");
          }
          throw new Error(`Unexpected ACP method: ${method}`);
        })
      ),
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
    methods.agent.session.prompt,
    LLM_SPACE_ACP_METHODS.snapshot,
    LLM_SPACE_ACP_METHODS.step,
    LLM_SPACE_ACP_METHODS.snapshot,
  ]);
  expect(updates.at(-1)?.context?.messages?.at(-1)).toMatchObject({
    id: "assistant-1",
    toolCalls: [{ id: "call-1", output: { isError: false } }],
  });
});

test("Playground runtime resumes the current Pi action through ACP Step", async () => {
  let playground = _playground({ operationId: "operation-1" });
  const calls: string[] = [];
  const runtime = createPlaygroundThreadExecutionRuntime({
    client: _client({ load: () => Promise.resolve(playground) }),
    playgroundId: playground.id,
    getPlayground: () => playground,
    onPlayground: (next) => {
      playground = next;
    },
    openAcpConnection: () =>
      Promise.resolve(
        _connection((method) => {
          calls.push(method);
          return Promise.resolve(_debug("model"));
        })
      ),
  });

  for await (const event of runtime.execute({
    thread: playgroundToEditorThread(playground),
    autoRunTools: false,
    reactLoop: false,
    signal: new AbortController().signal,
  })) {
    // Consume the editor projection.
    void event;
  }

  expect(calls).toEqual([
    LLM_SPACE_ACP_METHODS.snapshot,
    LLM_SPACE_ACP_METHODS.step,
  ]);
});

test("Playground runtime reports an ACP prompt failure to the editor", () => {
  let playground = _playground();
  const runtime = createPlaygroundThreadExecutionRuntime({
    client: _client({
      save: (_id, document) => {
        playground = { ...playground, ...document, dirty: true };
        return Promise.resolve(playground);
      },
    }),
    playgroundId: playground.id,
    getPlayground: () => playground,
    onPlayground: (next) => {
      playground = next;
    },
    openAcpConnection: ({ onSessionUpdate }) =>
      Promise.resolve(
        _connection((method) => {
          if (method !== methods.agent.session.prompt) {
            throw new Error(`Unexpected ACP method: ${method}`);
          }
          onSessionUpdate?.({
            sessionId: playground.sessionId,
            update: {
              sessionUpdate: "state_update",
              state: "idle",
              stopReason: "error",
              _meta: {
                "llm-space.dev": {
                  status: "failed",
                  error: "Model request failed.",
                },
              },
            },
          });
          return Promise.resolve({});
        })
      ),
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
        // Consume until the ACP failure rejects.
        void event;
      }
    })()
  ).rejects.toThrow("Model request failed.");
});

/** Creates a Pi-backed Playground projection without Engine compatibility fields. */
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

/** Builds one assistant projection with a pending or committed tool result. */
function _assistantWithTool(completed: boolean): AssistantMessage {
  return {
    id: "assistant-1",
    role: "assistant",
    content: [],
    toolCalls: [
      {
        id: "call-1",
        input: { name: "lookup", arguments: {} },
        ...(completed
          ? {
              output: {
                content: [{ type: "text" as const, text: "result" }],
                isError: false,
              },
            }
          : {}),
      },
    ],
  };
}

/** Supplies a minimal debugger response for adapter control-flow tests. */
function _debug(kind: "model" | "tool"): PiAcpDebugResponse {
  return {
    fromCursor: 0,
    cursor: 1,
    updates: [],
    snapshot: {
      cursor: 1,
      sessionId: "session-1",
      lane: "main",
      operationId: "operation-1",
      status: "paused",
      messageEntries: [],
      messages: [],
      leafId: "leaf-1",
      nextAction:
        kind === "model"
          ? { id: "operation-1:model:2:1", kind: "model", attempt: 1 }
          : {
              id: "operation-1:tool:assistant-1:0",
              kind: "tool",
              assistantEntryId: "assistant-1",
              toolIndex: 0,
              toolCallId: "call-1",
              toolName: "lookup",
            },
    },
  };
}

/** Creates a structural ACP connection whose AgentContext is test-controlled. */
function _connection(
  request: (method: string, params: unknown) => unknown
): ClientConnection {
  const controller = new AbortController();
  return {
    signal: controller.signal,
    closed: Promise.resolve(),
    close: () => controller.abort(),
    agent: {
      request: (method: string, params: unknown) =>
        Promise.resolve(request(method, params)),
      notify: () => Promise.resolve(),
    },
  } as unknown as ClientConnection;
}

/** Emits the standard ACP state transition used after an accepted prompt. */
function _stoppedUpdate(sessionId: string): UpdateSessionNotification {
  return {
    sessionId,
    update: {
      sessionUpdate: "state_update",
      state: "requires_action",
      _meta: { "llm-space.dev": { status: "paused" } },
    },
  };
}

/** Fills the metadata-only Playground client methods used by the adapter. */
function _client(overrides: Partial<PlaygroundClient> = {}): PlaygroundClient {
  const playground = _playground();
  return {
    list: () => Promise.resolve([playground]),
    create: () => Promise.resolve(playground),
    load: () => Promise.resolve(playground),
    save: () => Promise.resolve(playground),
    ...overrides,
  };
}
