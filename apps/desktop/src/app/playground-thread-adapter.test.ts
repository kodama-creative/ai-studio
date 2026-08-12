import { expect, test } from "bun:test";

import type { AssistantMessage, Thread } from "@llm-space/core";
import type { Run, RunFrame } from "@llm-space/engine";
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

test("Playground runtime keeps one Run while step mode auto-executes pending tools", async () => {
  let playground = _playground();
  const calls: string[] = [];
  const client = _client({
    load: () => {
      const assistant = _assistantWithTool(
        calls.some((call) => call.startsWith("step:"))
      );
      playground = {
        ...playground,
        activeRunId: "run-1",
        conversation: {
          ...playground.conversation,
          messages: [USER_MESSAGE, assistant],
        },
      };
      return Promise.resolve(playground);
    },
    save: (_id, document) => {
      playground = {
        ...playground,
        title: document.title,
        agentSpec: document.agentSpec,
        conversation: document.conversation,
        dirty: true,
      };
      calls.push("save");
      return Promise.resolve(playground);
    },
    run: (_id, input) => {
      expect(input.mode).toBe("step");
      calls.push("run:step");
      playground = { ...playground, activeRunId: "run-1", dirty: false };
      return Promise.resolve({ runId: "run-1" });
    },
    stepRun: (runId, input) => {
      calls.push(`step:${runId}:${input?.toolCallId}`);
      return Promise.resolve({ runId });
    },
    streamRun: (runId) =>
      _frames(
        calls.filter((call) => call.startsWith("step:")).length === 0
          ? _modelPause(runId)
          : _toolPause(runId)
      ),
  });
  const runtime = createPlaygroundThreadExecutionRuntime({
    client,
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

  expect(calls).toEqual(["save", "run:step", "step:run-1:call-1"]);
  expect(updates.at(-1)?.context?.messages?.at(-1)).toMatchObject({
    id: "assistant-1",
    toolCalls: [{ id: "call-1", output: { isError: false } }],
  });
});

test("Playground runtime resumes a paused Run instead of creating another Run", async () => {
  let playground = _playground({
    activeRunId: "run-1",
    conversation: {
      messages: [USER_MESSAGE, _assistantWithTool(true)],
      state: { preserved: true },
    },
  });
  const calls: string[] = [];
  const client = _client({
    load: () => Promise.resolve(playground),
    stepRun: (runId) => {
      calls.push(`step:${runId}`);
      return Promise.resolve({ runId });
    },
    streamRun: (runId) => _frames(_completed(runId)),
  });
  const runtime = createPlaygroundThreadExecutionRuntime({
    client,
    playgroundId: playground.id,
    getPlayground: () => playground,
    onPlayground: (next) => {
      playground = next;
    },
  });

  for await (const event of runtime.execute({
    thread: playgroundToEditorThread(playground),
    fromMessageId: "assistant-1",
    autoRunTools: false,
    reactLoop: false,
    signal: new AbortController().signal,
  })) {
    void event;
  }

  expect(calls).toEqual(["step:run-1"]);
});

test("Playground runtime reports a failed durable Run to the editor", () => {
  let playground = _playground({ activeRunId: "run-1" });
  const failedRun: Run = {
    ..._run("run-1", "failed"),
    error: { code: "model_failed", message: "Model request failed." },
  };
  const runtime = createPlaygroundThreadExecutionRuntime({
    client: _client({
      load: () => Promise.resolve(playground),
      stepRun: (runId) => Promise.resolve({ runId }),
      streamRun: () =>
        _frames([
          {
            type: "snapshot",
            cursor: 0,
            run: failedRun,
            outputs: [],
            headCheckpointId: "checkpoint-2",
          },
        ]),
    }),
    playgroundId: playground.id,
    getPlayground: () => playground,
    onPlayground: (next) => {
      playground = next;
    },
  });

  return expect(
    (async () => {
      await Promise.resolve();
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

function _playground(overrides: Partial<Playground> = {}): Playground {
  return {
    schemaVersion: 1,
    id: "playground-1",
    title: "Example",
    engineThreadId: "thread-1",
    headCheckpointId: "checkpoint-1",
    agentSpec: {
      schemaVersion: 1,
      model: { provider: "test", id: "model" },
      instructions: ["Answer."],
      tools: [
        {
          type: "function",
          name: "lookup",
          description: "Lookup",
          parameters: {},
        },
      ],
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

function _run(runId: string, status: Run["status"]): Run {
  return {
    schemaVersion: 1,
    id: runId,
    threadId: "thread-1",
    operationId: "operation-1",
    inputMessages: [USER_MESSAGE],
    baseCheckpointId: "checkpoint-1",
    inputCheckpointId: "checkpoint-2",
    agentSnapshot: {
      schemaVersion: 1,
      agentId: "playground:playground-1",
      generationId: "playground:playground-1",
      model: "test/model",
      instructions: ["Answer."],
      tools: [],
    },
    control: { mode: "step" },
    status,
    createdAt: 1,
  };
}

function _modelPause(runId: string): RunFrame[] {
  return [
    {
      type: "snapshot",
      cursor: 0,
      run: _run(runId, "running"),
      outputs: [],
      headCheckpointId: "checkpoint-2",
    },
    {
      type: "event",
      cursor: 1,
      event: {
        type: "message.completed",
        message: _assistantWithTool(false),
      },
    },
    {
      type: "event",
      cursor: 2,
      event: {
        type: "checkpoint.committed",
        checkpointId: "checkpoint-3",
        reason: "step",
      },
    },
    {
      type: "event",
      cursor: 3,
      event: {
        type: "run.updated",
        run: {
          ..._run(runId, "paused"),
          pause: {
            reason: "step.completed",
            step: "model.completed",
            checkpointId: "checkpoint-3",
            pausedAt: 2,
          },
        },
      },
    },
  ];
}

function _toolPause(runId: string): RunFrame[] {
  return [
    {
      type: "snapshot",
      cursor: 3,
      run: _run(runId, "running"),
      outputs: [],
      headCheckpointId: "checkpoint-3",
    },
    {
      type: "event",
      cursor: 4,
      event: {
        type: "tool.completed",
        messageId: "assistant-1",
        toolCallId: "call-1",
        message: _assistantWithTool(true),
      },
    },
    {
      type: "event",
      cursor: 5,
      event: {
        type: "checkpoint.committed",
        checkpointId: "checkpoint-4",
        reason: "step",
      },
    },
    {
      type: "event",
      cursor: 6,
      event: {
        type: "run.updated",
        run: {
          ..._run(runId, "paused"),
          pause: {
            reason: "step.completed",
            step: "tool.completed",
            checkpointId: "checkpoint-4",
            pausedAt: 3,
          },
        },
      },
    },
  ];
}

function _completed(runId: string): RunFrame[] {
  return [
    {
      type: "snapshot",
      cursor: 0,
      run: _run(runId, "completed"),
      outputs: [],
      headCheckpointId: "checkpoint-4",
    },
  ];
}

async function* _frames(frames: readonly RunFrame[]): AsyncIterable<RunFrame> {
  await Promise.resolve();
  for (const frame of frames) yield frame;
}

function _client(overrides: Partial<PlaygroundClient>): PlaygroundClient {
  const unsupported = () => new Error("Unexpected PlaygroundClient call.");
  return {
    list: () => Promise.reject(unsupported()),
    create: () => Promise.reject(unsupported()),
    load: () => Promise.reject(unsupported()),
    save: () => Promise.reject(unsupported()),
    run: () => Promise.reject(unsupported()),
    stepRun: () => Promise.reject(unsupported()),
    continueRun: () => Promise.reject(unsupported()),
    cancelRun: () => Promise.reject(unsupported()),
    streamRun: () => _frames([]),
    ...overrides,
  };
}
