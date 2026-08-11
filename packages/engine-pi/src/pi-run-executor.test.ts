import { expect, test } from "bun:test";

import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import type { JsonObject, ToolContext } from "@llm-space/agent/tools";
import type {
  AgentSnapshot,
  RunExecutionEvent,
  RunExecutionInput,
  RunExecutionSink,
} from "@llm-space/engine";

import { createPiRunExecutor } from "./pi-run-executor";

const INCREMENT_SCHEMA: JsonObject = {
  type: "object",
  properties: { amount: { type: "number" } },
  required: ["amount"],
  additionalProperties: false,
};

test("Pi executor runs the complete model-tool-model loop behind one Run", async () => {
  const faux = fauxProvider({ tokensPerSecond: 0 });
  const model = faux.getModel();
  const toolAgent: AgentSnapshot = {
    schemaVersion: 1,
    agentId: "counter-agent",
    generationId: "generation-1",
    model: `${model.provider}/${model.id}`,
    instructions: ["Use the counter tool."],
    tools: [
      {
        name: "increment",
        description: "Increment a number",
        inputSchema: INCREMENT_SCHEMA,
      },
    ],
  };
  let secondTurnMessages: unknown;
  faux.setResponses([
    fauxAssistantMessage(
      [fauxToolCall("increment", { amount: 2 }, { id: "call-1" })],
      { stopReason: "toolUse" }
    ),
    (context) => {
      secondTurnMessages = context.messages;
      return fauxAssistantMessage([
        {
          type: "text",
          text: "Counter is 2.",
          annotations: [
            {
              type: "url_citation",
              url: "https://example.com/counter",
              raw: { source: "faux" },
            },
          ],
        },
      ]);
    },
  ]);
  const models = createModels();
  models.setProvider(faux.provider);
  const events: RunExecutionEvent[] = [];
  const sink: RunExecutionSink = {
    accept(event) {
      events.push(event);
      return Promise.resolve();
    },
  };
  const executor = createPiRunExecutor({ models });

  await executor.execute(
    {
      runId: "run-1",
      threadId: "thread-1",
      messages: [
        {
          id: "user-1",
          role: "user",
          content: [{ type: "text", text: "Increment by two" }],
        },
      ],
      agent: {
        snapshot: toolAgent,
        tools: new Map([
          [
            "increment",
            {
              definition: {
                description: "Increment a number",
                inputSchema: INCREMENT_SCHEMA,
                execute(input) {
                  return { count: (input as { amount: number }).amount };
                },
              },
            },
          ],
        ]),
      },
      maxModelTurns: 4,
      createMessageId: () => `assistant-${events.length}`,
      createToolContext: ({ execution, signal }) =>
        _toolContext(execution, signal),
    },
    sink,
    { signal: new AbortController().signal }
  );

  expect(
    events.map(({ type }) => type).filter((type) => type !== "assistant.delta")
  ).toEqual([
    "assistant.completed",
    "tool.started",
    "tool.completed",
    "assistant.completed",
  ]);
  expect(events[2]).toMatchObject({
    type: "tool.completed",
    message: {
      toolCalls: [
        {
          id: "call-1",
          output: {
            content: [{ type: "text", text: '{"count":2}' }],
            isError: false,
          },
        },
      ],
    },
  });
  expect(events.at(-1)).toMatchObject({
    type: "assistant.completed",
    message: {
      content: [
        {
          type: "text",
          text: "Counter is 2.",
          annotations: [
            {
              type: "url_citation",
              url: "https://example.com/counter",
              raw: { source: "faux" },
            },
          ],
        },
      ],
    },
  });
  expect(secondTurnMessages).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        role: "toolResult",
        toolCallId: "call-1",
        content: [{ type: "text", text: '{"count":2}' }],
      }),
    ])
  );
});

test("Pi executor expands historical tool outputs and preserves images", async () => {
  const faux = fauxProvider({ tokensPerSecond: 0 });
  const model = faux.getModel();
  let observedMessages: unknown;
  faux.setResponses([
    (context) => {
      observedMessages = context.messages;
      return fauxAssistantMessage("received");
    },
  ]);
  const models = createModels();
  models.setProvider(faux.provider);
  const executor = createPiRunExecutor({ models });

  await executor.execute(
    {
      runId: "run-history",
      threadId: "thread-history",
      messages: [
        {
          id: "user-history",
          role: "user",
          content: [
            { type: "text", text: "Inspect it" },
            { type: "image", data: "dXNlcg==", mimeType: "image/png" },
          ],
        },
        {
          id: "assistant-history",
          role: "assistant",
          content: [],
          toolCalls: [
            {
              id: "call-history",
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
      agent: {
        snapshot: {
          schemaVersion: 1,
          agentId: "history-agent",
          generationId: "generation-1",
          model: `${model.provider}/${model.id}`,
          instructions: [],
          tools: [],
        },
        tools: new Map(),
      },
      maxModelTurns: 4,
      createMessageId: () => "assistant-result",
      createToolContext: ({ execution, signal }) =>
        _toolContext(execution, signal),
    },
    { accept: () => Promise.resolve() },
    { signal: new AbortController().signal }
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
        {
          type: "toolCall",
          id: "call-history",
          name: "image",
          arguments: {},
        },
      ],
    }),
    {
      role: "toolResult",
      toolCallId: "call-history",
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

test("Pi executor emits iterable progress and reserves the last part for completion", async () => {
  const faux = fauxProvider({ tokensPerSecond: 0 });
  const model = faux.getModel();
  faux.setResponses([
    fauxAssistantMessage([fauxToolCall("stream", {}, { id: "call-stream" })], {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("finished"),
  ]);
  const models = createModels();
  models.setProvider(faux.provider);
  const events: RunExecutionEvent[] = [];

  await createPiRunExecutor({ models }).execute(
    {
      ..._emptyRunInput(model, "run-stream"),
      agent: {
        snapshot: {
          schemaVersion: 1,
          agentId: "stream-agent",
          generationId: "generation-1",
          model: `${model.provider}/${model.id}`,
          instructions: [],
          tools: [
            { name: "stream", description: "Stream work", inputSchema: {} },
          ],
        },
        tools: new Map([
          [
            "stream",
            {
              definition: {
                description: "Stream work",
                inputSchema: {},
                async *execute() {
                  await Promise.resolve();
                  yield "draft";
                  yield "final";
                },
              },
            },
          ],
        ]),
      },
    },
    {
      accept(event) {
        events.push(event);
        return Promise.resolve();
      },
    },
    { signal: new AbortController().signal }
  );

  expect(
    events
      .filter(
        (event) =>
          event.type === "tool.updated" || event.type === "tool.completed"
      )
      .map((event) => ({
        type: event.type,
        output: event.message.toolCalls?.[0]?.output,
      }))
  ).toEqual([
    {
      type: "tool.updated",
      output: {
        content: [{ type: "text", text: "draft" }],
        isError: false,
      },
    },
    {
      type: "tool.completed",
      output: {
        content: [{ type: "text", text: "final" }],
        isError: false,
      },
    },
  ]);
});

test("Pi executor converts invalid tool input into a durable error result", async () => {
  const faux = fauxProvider({ tokensPerSecond: 0 });
  const model = faux.getModel();
  faux.setResponses([
    fauxAssistantMessage(
      [fauxToolCall("increment", { amount: "invalid" }, { id: "call-invalid" })],
      { stopReason: "toolUse" }
    ),
    fauxAssistantMessage("recovered"),
  ]);
  const models = createModels();
  models.setProvider(faux.provider);
  const events: RunExecutionEvent[] = [];
  let executed = false;

  await createPiRunExecutor({ models }).execute(
    {
      ..._emptyRunInput(model, "run-invalid"),
      agent: {
        snapshot: {
          schemaVersion: 1,
          agentId: "validation-agent",
          generationId: "generation-1",
          model: `${model.provider}/${model.id}`,
          instructions: [],
          tools: [
            {
              name: "increment",
              description: "Increment a number",
              inputSchema: INCREMENT_SCHEMA,
            },
          ],
        },
        tools: new Map([
          [
            "increment",
            {
              definition: {
                description: "Increment a number",
                inputSchema: INCREMENT_SCHEMA,
                execute() {
                  executed = true;
                  return "unexpected";
                },
              },
            },
          ],
        ]),
      },
    },
    {
      accept(event) {
        events.push(event);
        return Promise.resolve();
      },
    },
    { signal: new AbortController().signal }
  );

  expect(executed).toBeFalse();
  expect(events.find((event) => event.type === "tool.completed")).toMatchObject(
    {
      type: "tool.completed",
      message: {
        toolCalls: [
          {
            id: "call-invalid",
            output: { isError: true },
          },
        ],
      },
    }
  );
});

test("Pi executor rejects provider error and truncated terminal responses", async () => {
  const faux = fauxProvider({ tokensPerSecond: 0 });
  const model = faux.getModel();
  faux.setResponses([
    fauxAssistantMessage([], {
      stopReason: "error",
      errorMessage: "provider failed",
    }),
    fauxAssistantMessage("partial", { stopReason: "length" }),
  ]);
  const models = createModels();
  models.setProvider(faux.provider);
  const executor = createPiRunExecutor({ models });
  const sink: RunExecutionSink = { accept: () => Promise.resolve() };

  expect(
    (
      await _rejection(
        executor.execute(
          _emptyRunInput(model, "run-provider-error"),
          sink,
          { signal: new AbortController().signal }
        )
      )
    ).message
  ).toContain("provider failed");
  expect(
    (
      await _rejection(
        executor.execute(_emptyRunInput(model, "run-length"), sink, {
          signal: new AbortController().signal,
        })
      )
    ).message
  ).toContain("output limit was reached");
});

test("Pi executor rejects a loop that exhausts the model-turn limit", async () => {
  const faux = fauxProvider({ tokensPerSecond: 0 });
  const model = faux.getModel();
  faux.setResponses([
    fauxAssistantMessage([fauxToolCall("work", {}, { id: "call-limit" })], {
      stopReason: "toolUse",
    }),
  ]);
  const models = createModels();
  models.setProvider(faux.provider);
  const input = _emptyRunInput(model, "run-limit");

  const error = await _rejection(
    createPiRunExecutor({ models }).execute(
      {
        ...input,
        maxModelTurns: 1,
        agent: {
          snapshot: {
            ...input.agent.snapshot,
            tools: [
              { name: "work", description: "Do work", inputSchema: {} },
            ],
          },
          tools: new Map([
            [
              "work",
              {
                definition: {
                  description: "Do work",
                  inputSchema: {},
                  execute: () => "done",
                },
              },
            ],
          ]),
        },
      },
      { accept: () => Promise.resolve() },
      { signal: new AbortController().signal }
    )
  );
  expect(error.message).toContain("exceeded 1 model turns");
});

test("Pi executor waits for durable assistant and tool checkpoints", async () => {
  const faux = fauxProvider({ tokensPerSecond: 0 });
  const model = faux.getModel();
  let secondModelStarted = false;
  faux.setResponses([
    fauxAssistantMessage([fauxToolCall("work", {}, { id: "call-barrier" })], {
      stopReason: "toolUse",
    }),
    () => {
      secondModelStarted = true;
      return fauxAssistantMessage("finished");
    },
  ]);
  const models = createModels();
  models.setProvider(faux.provider);
  const executor = createPiRunExecutor({ models });
  const assistantReached = _deferred<void>();
  const releaseCheckpoint = _deferred<void>();
  const toolReached = _deferred<void>();
  const releaseToolCheckpoint = _deferred<void>();
  let assistantCount = 0;
  let toolStarted = false;

  const execution = executor.execute(
    {
      runId: "run-barrier",
      threadId: "thread-barrier",
      messages: [
        {
          id: "user-barrier",
          role: "user",
          content: [{ type: "text", text: "work" }],
        },
      ],
      agent: {
        snapshot: {
          schemaVersion: 1,
          agentId: "barrier-agent",
          generationId: "generation-1",
          model: `${model.provider}/${model.id}`,
          instructions: [],
          tools: [
            {
              name: "work",
              description: "Do work",
              inputSchema: {},
            },
          ],
        },
        tools: new Map([
          [
            "work",
            {
              definition: {
                description: "Do work",
                inputSchema: {},
                execute() {
                  toolStarted = true;
                  return "done";
                },
              },
            },
          ],
        ]),
      },
      maxModelTurns: 4,
      createMessageId: () => `assistant-barrier-${assistantCount}`,
      createToolContext: ({ execution: contextExecution, signal }) =>
        _toolContext(contextExecution, signal),
    },
    {
      async accept(event) {
        if (event.type === "assistant.completed") {
          assistantCount++;
          if (assistantCount !== 1) return;
          assistantReached.resolve();
          await releaseCheckpoint.promise;
        } else if (event.type === "tool.completed") {
          toolReached.resolve();
          await releaseToolCheckpoint.promise;
        }
      },
    },
    { signal: new AbortController().signal }
  );

  await assistantReached.promise;
  expect(toolStarted).toBeFalse();
  releaseCheckpoint.resolve();
  await toolReached.promise;
  expect(secondModelStarted).toBeFalse();
  releaseToolCheckpoint.resolve();
  await execution;
  expect(toolStarted).toBeTrue();
  expect(secondModelStarted).toBeTrue();
});

function _toolContext(
  execution: ToolContext["execution"],
  signal: AbortSignal
): ToolContext {
  return {
    execution,
    abortSignal: signal,
    getSandbox() {
      throw new Error("Sandbox is unavailable in this test.");
    },
    getSkill() {
      throw new Error("Skills are unavailable in this test.");
    },
    getToken() {
      return Promise.reject(new Error("Auth is unavailable in this test."));
    },
    requireAuth() {
      throw new Error("Auth is unavailable in this test.");
    },
  };
}

function _emptyRunInput(
  model: { readonly provider: string; readonly id: string },
  runId: string
): RunExecutionInput {
  return {
    runId,
    threadId: `thread-${runId}`,
    messages: [
      {
        id: `user-${runId}`,
        role: "user",
        content: [{ type: "text", text: "continue" }],
      },
    ],
    agent: {
      snapshot: {
        schemaVersion: 1,
        agentId: "test-agent",
        generationId: "generation-1",
        model: `${model.provider}/${model.id}`,
        instructions: [],
        tools: [],
      },
      tools: new Map(),
    },
    maxModelTurns: 4,
    createMessageId: () => `assistant-${runId}`,
    createToolContext: ({ execution, signal }) =>
      _toolContext(execution, signal),
  };
}

/** Captures an expected execution failure without Bun's non-thenable matcher. */
async function _rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
  throw new Error("Expected execution to reject.");
}

function _deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}
