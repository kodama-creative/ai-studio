import { expect, test } from "bun:test";

import type { StudioThread } from "@llm-space/studio";

import type { ProjectStudioClient } from "@/client/project-studio-client";

import {
  playgroundThreadToStudioEvaluationMetadata,
  playgroundThreadToStudioDocument,
  createProjectThreadExecutionRuntime,
  shouldPersistProjectThread,
  studioThreadToPlaygroundThread,
} from "./project-thread-adapter";

test("Studio Thread messages and tool results map into the existing Playground model", () => {
  const thread: StudioThread = {
    schemaVersion: 1,
    id: "thread-1",
    engineThreadId: "engine-thread-1",
    headCheckpointId: "checkpoint-1",
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

test("Engine projections are not persisted again as a Studio Draft", () => {
  const thread = _projectThreadWithPendingTool();
  const projection = studioThreadToPlaygroundThread(thread);

  expect(playgroundThreadToStudioDocument(projection, thread)).toEqual(
    thread.document
  );
  expect(shouldPersistProjectThread(projection, thread)).toBeFalse();
  expect(
    shouldPersistProjectThread(
      {
        ...projection,
        context: {
          ...projection.context,
          messages: [
            ...(projection.context?.messages ?? []),
            {
              id: "user-edit",
              role: "user",
              content: [{ type: "text", text: "Continue" }],
            },
          ],
        },
      },
      thread
    )
  ).toBeTrue();
});

test("Project runtime maps UI step and ReAct controls onto the same durable Run", async () => {
  let thread: StudioThread = {
    schemaVersion: 1,
    id: "experiment-1",
    engineThreadId: "thread-1",
    headCheckpointId: "checkpoint-1",
    document: {
      title: "Example",
      agent: {
        schemaVersion: 1,
        agentId: "agent",
        generationId: "uncommitted",
        model: "test/model",
        instructions: [],
        tools: [],
      },
      conversation: {
        messages: [
          {
            id: "user-1",
            role: "user",
            content: [{ type: "text", text: "hello" }],
          },
        ],
        state: {},
      },
    },
    createdAt: 1,
    updatedAt: 1,
  };
  const calls: string[] = [];
  const client = {
    saveDocument: () => Promise.resolve(thread),
    run: (
      _threadId: string,
      input: Parameters<ProjectStudioClient["run"]>[1]
    ) => {
      calls.push(`run:${input.mode}:${input.modelOverride}`);
      thread = { ...thread, activeRunId: "run-1" };
      return Promise.resolve({ runId: "run-1" });
    },
    events: async function* () {
      await Promise.resolve();
      yield {
        threadId: thread.id,
        sequence: 1,
        timestamp: 1,
        event: {
          type: "run.paused" as const,
          run: _pausedProjectRun(),
        },
      };
    },
    listRunHistory: () => Promise.resolve([]),
    listEvaluationMetadata: () =>
      Promise.resolve({ evaluations: [], rubrics: [] }),
    loadThread: () => Promise.resolve(thread),
    stepRun: (runId: string) => {
      calls.push(`step:${runId}`);
      return Promise.resolve({ runId });
    },
    continueRun: (runId: string) => {
      calls.push(`continue:${runId}`);
      return Promise.resolve({ runId });
    },
    cancelRun: () => Promise.resolve(),
  } as unknown as ProjectStudioClient;
  const runtime = createProjectThreadExecutionRuntime({
    client,
    threadId: thread.id,
    getThread: () => thread,
    onThread: (next) => {
      thread = next;
    },
  });

  for await (const event of runtime.execute({
    thread: {
      ...studioThreadToPlaygroundThread(thread),
      model: { provider: "override", id: "model" },
    },
    fromMessageId: "user-1",
    autoRunTools: false,
    reactLoop: false,
    signal: new AbortController().signal,
  })) {
    void event;
  }
  for await (const event of runtime.execute({
    thread: studioThreadToPlaygroundThread(thread),
    fromMessageId: "user-1",
    autoRunTools: true,
    reactLoop: true,
    signal: new AbortController().signal,
  })) {
    void event;
  }

  expect(calls).toEqual(["run:step:override/model", "continue:run-1"]);
});

test("Project runtime auto-executes one paused tool phase without advancing the model", async () => {
  let thread: StudioThread = {
    ..._projectThreadWithPendingTool(),
    activeRunId: undefined,
  };
  const calls: string[] = [];
  let subscription = 0;
  const client = {
    saveDocument: () => Promise.resolve(thread),
    run: () => {
      calls.push("run:step");
      thread = { ...thread, activeRunId: "run-1" };
      return Promise.resolve({ runId: "run-1" });
    },
    events: async function* () {
      await Promise.resolve();
      subscription += 1;
      if (subscription === 1) {
        yield {
          threadId: thread.id,
          sequence: 1,
          timestamp: 1,
          event: { type: "run.paused" as const, run: _pausedProjectRun() },
        };
        return;
      }
      yield {
        threadId: thread.id,
        sequence: 2,
        timestamp: 2,
        event: {
          type: "run.paused" as const,
          run: {
            ..._pausedProjectRun(),
            pause: {
              ..._pausedProjectRun().pause,
              step: "tool.completed" as const,
            },
          },
        },
      };
    },
    listRunHistory: () => Promise.resolve([]),
    listEvaluationMetadata: () =>
      Promise.resolve({ evaluations: [], rubrics: [] }),
    loadThread: () => Promise.resolve(thread),
    stepRun: (runId: string, input?: { readonly toolCallId?: string }) => {
      calls.push(`step:${runId}:${input?.toolCallId}`);
      thread = _projectThreadWithPendingTool(true);
      return Promise.resolve({ runId });
    },
    continueRun: (runId: string) => Promise.resolve({ runId }),
    cancelRun: () => Promise.resolve(),
  } as unknown as ProjectStudioClient;
  const runtime = createProjectThreadExecutionRuntime({
    client,
    threadId: thread.id,
    getThread: () => thread,
    onThread: (next) => {
      thread = next;
    },
  });

  for await (const event of runtime.execute({
    thread: studioThreadToPlaygroundThread(thread),
    fromMessageId: "user-1",
    autoRunTools: true,
    reactLoop: false,
    signal: new AbortController().signal,
  })) {
    void event;
  }

  expect(calls).toEqual(["run:step", "step:run-1:call-1"]);
});

test("Project runtime exposes the automatic Tool lifecycle to the UI", async () => {
  let thread: StudioThread = {
    ..._projectThreadWithPendingTool(),
    activeRunId: undefined,
  };
  const assistant = thread.document.conversation.messages.at(-1);
  if (assistant?.role !== "assistant") {
    throw new Error("Expected an Assistant Message fixture.");
  }
  const completedAssistant = {
    ...assistant,
    toolCalls: assistant.toolCalls?.map((call) => ({
      ...call,
      output: {
        content: [{ type: "text" as const, text: "result" }],
        isError: false,
      },
    })),
  };
  const client = {
    saveDocument: () => Promise.resolve(thread),
    run: () => {
      thread = { ...thread, activeRunId: "run-1" };
      return Promise.resolve({ runId: "run-1" });
    },
    events: async function* () {
      await Promise.resolve();
      const events = [
        {
          type: "message.completed" as const,
          runId: "run-1",
          message: assistant,
        },
        {
          type: "tool.started" as const,
          runId: "run-1",
          messageId: assistant.id,
          toolCallId: "call-1",
          toolName: "lookup",
        },
        {
          type: "tool.updated" as const,
          runId: "run-1",
          messageId: assistant.id,
          toolCallId: "call-1",
          message: completedAssistant,
        },
        {
          type: "tool.completed" as const,
          runId: "run-1",
          messageId: assistant.id,
          toolCallId: "call-1",
          message: completedAssistant,
        },
        { type: "run.completed" as const, runId: "run-1" },
      ];
      for (const [index, event] of events.entries()) {
        yield {
          threadId: thread.id,
          sequence: index + 1,
          timestamp: index + 1,
          event,
        };
      }
    },
    listRunHistory: () => Promise.resolve([]),
    listEvaluationMetadata: () =>
      Promise.resolve({ evaluations: [], rubrics: [] }),
    loadThread: () => Promise.resolve(thread),
    stepRun: (runId: string) => Promise.resolve({ runId }),
    continueRun: (runId: string) => Promise.resolve({ runId }),
    cancelRun: () => Promise.resolve(),
  } as unknown as ProjectStudioClient;
  const runtime = createProjectThreadExecutionRuntime({
    client,
    threadId: thread.id,
    getThread: () => thread,
    onThread: (next) => {
      thread = next;
    },
  });
  const events = [];

  for await (const event of runtime.execute({
    thread: studioThreadToPlaygroundThread(thread),
    fromMessageId: "user-1",
    autoRunTools: true,
    reactLoop: true,
    signal: new AbortController().signal,
  })) {
    events.push(event);
  }

  expect(events.map((event) => event.type)).toEqual([
    "thread.updated",
    "tool.started",
    "thread.updated",
    "thread.updated",
    "tool.completed",
    "thread.updated",
  ]);
});

test("manual Tool execution ignores the preceding model pause before Continue", async () => {
  let thread = _projectThreadWithPendingTool();
  const calls: string[] = [];
  const completed = _projectThreadWithPendingTool(true);
  const completedMessage = completed.document.conversation.messages.at(-1);
  if (completedMessage?.role !== "assistant") {
    throw new Error("Expected an Assistant Message fixture.");
  }
  let subscription = 0;
  const client = {
    events: async function* () {
      await Promise.resolve();
      subscription += 1;
      if (subscription === 1) {
        // Studio event subscriptions replay durable history. This is the pause
        // that exposed the Tool call, not the pause produced by this action.
        yield {
          threadId: thread.id,
          sequence: 1,
          timestamp: 1,
          event: { type: "run.paused" as const, run: _pausedProjectRun() },
        };
        yield {
          threadId: thread.id,
          sequence: 2,
          timestamp: 2,
          event: {
            type: "tool.completed" as const,
            runId: "run-1",
            messageId: completedMessage.id,
            toolCallId: "call-1",
            message: completedMessage,
          },
        };
        thread = completed;
        yield {
          threadId: thread.id,
          sequence: 3,
          timestamp: 3,
          event: {
            type: "run.paused" as const,
            run: {
              ..._pausedProjectRun(),
              pause: {
                ..._pausedProjectRun().pause,
                step: "tool.completed" as const,
              },
            },
          },
        };
        return;
      }
      yield {
        threadId: thread.id,
        sequence: 4,
        timestamp: 4,
        event: { type: "run.completed" as const, runId: "run-1" },
      };
    },
    stepRun: (runId: string) => {
      calls.push(`step:${runId}:call-1`);
      return Promise.resolve({ runId });
    },
    continueRun: (runId: string) => {
      calls.push(`continue:${runId}`);
      return Promise.resolve({ runId });
    },
    run: () => {
      calls.push("run:new");
      return Promise.resolve({ runId: "run-new" });
    },
    saveDocument: () => Promise.resolve(thread),
    listRunHistory: () => Promise.resolve([]),
    listEvaluationMetadata: () =>
      Promise.resolve({ evaluations: [], rubrics: [] }),
    loadThread: () => Promise.resolve(thread),
    cancelRun: () => Promise.resolve(),
  } as unknown as ProjectStudioClient;
  const runtime = createProjectThreadExecutionRuntime({
    client,
    threadId: thread.id,
    getThread: () => thread,
    onThread: (next) => {
      thread = next;
    },
  });
  const toolEvents = [];

  for await (const event of runtime.executeToolCall!({
    thread: studioThreadToPlaygroundThread(thread),
    messageId: "assistant-1",
    toolCallId: "call-1",
    signal: new AbortController().signal,
  })) {
    toolEvents.push(event);
  }
  for await (const event of runtime.execute({
    thread: studioThreadToPlaygroundThread(thread),
    autoRunTools: true,
    reactLoop: true,
    signal: new AbortController().signal,
  })) {
    void event;
  }

  expect(
    toolEvents.some((event) => {
      if (event.type !== "thread.updated") return false;
      const message = event.thread.context?.messages?.at(-1);
      return (
        message?.role === "assistant" &&
        message.toolCalls?.[0]?.output !== undefined
      );
    })
  ).toBeTrue();
  expect(calls).toEqual(["step:run-1:call-1", "continue:run-1"]);
});

function _pausedProjectRun() {
  return {
    schemaVersion: 1 as const,
    id: "run-1",
    threadId: "thread-1",
    operationId: "operation-1",
    inputMessages: [],
    baseCheckpointId: "checkpoint-1",
    inputCheckpointId: "checkpoint-2",
    agentSnapshot: {
      schemaVersion: 1 as const,
      agentId: "agent",
      generationId: "uncommitted",
      model: "test/model",
      instructions: [],
      tools: [],
    },
    control: { mode: "step" as const },
    status: "paused" as const,
    pause: {
      reason: "step.completed" as const,
      step: "model.completed" as const,
      checkpointId: "checkpoint-3",
      pausedAt: 1,
    },
    createdAt: 1,
  };
}

function _projectThreadWithPendingTool(completed = false): StudioThread {
  return {
    schemaVersion: 1,
    id: "experiment-1",
    engineThreadId: "thread-1",
    headCheckpointId: completed ? "checkpoint-4" : "checkpoint-3",
    document: {
      title: "Example",
      agent: {
        schemaVersion: 1,
        agentId: "agent",
        generationId: "uncommitted",
        model: "test/model",
        instructions: [],
        tools: [{ name: "lookup", description: "Lookup", inputSchema: {} }],
      },
      conversation: {
        messages: [
          {
            id: "user-1",
            role: "user",
            content: [{ type: "text", text: "hello" }],
          },
          {
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
          },
        ],
        state: {},
      },
    },
    activeRunId: "run-1",
    createdAt: 1,
    updatedAt: 1,
  };
}

test("Studio Evaluation resources map to Playground metadata without entering the Thread document", () => {
  const thread: StudioThread = {
    schemaVersion: 1,
    id: "thread-1",
    engineThreadId: "engine-thread-1",
    headCheckpointId: "checkpoint-1",
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
