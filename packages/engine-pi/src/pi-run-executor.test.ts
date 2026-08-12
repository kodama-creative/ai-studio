import { expect, test } from "bun:test";

import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import type { JsonObject, ToolContext } from "@llm-space/agent/tools";
import { createAgentEngine, InMemoryEngineStore } from "@llm-space/engine";
import type {
  AgentEngine,
  AgentSnapshot,
  ExecutableAgent,
  RunExecutionEvent,
  RunExecutionInput,
  RunExecutionSink,
  RunExecutor,
} from "@llm-space/engine";

import { createPiRunExecutor } from "./pi-run-executor";

const INCREMENT_SCHEMA: JsonObject = {
  type: "object",
  properties: { amount: { type: "number" } },
  required: ["amount"],
  additionalProperties: false,
};

test("Pi executor advances one model or tool step at a time", async () => {
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

  const input: RunExecutionInput = {
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
      step: { type: "model" },
      stepIndex: 0,
      createMessageId: () => `assistant-${events.length}`,
      createToolContext: ({ execution, signal }) =>
        _toolContext(execution, signal),
    };

  await executor.executeStep(
    input,
    sink,
    { signal: new AbortController().signal }
  );

  expect(
    events.map(({ type }) => type).filter((type) => type !== "assistant.delta")
  ).toEqual(["assistant.completed"]);
  const requested = events.find(
    (event) => event.type === "assistant.completed"
  );
  if (requested?.type !== "assistant.completed") {
    throw new Error("The model step did not complete an Assistant Message.");
  }

  await executor.executeStep(
    {
      ...input,
      messages: [...input.messages, requested.message],
      step: { type: "tools", toolCallIds: ["call-1"] },
      stepIndex: 1,
    },
    sink,
    { signal: new AbortController().signal }
  );
  const toolCompleted = events.findLast(
    (event) => event.type === "tool.completed"
  );
  if (toolCompleted?.type !== "tool.completed") {
    throw new Error("The tool step did not complete.");
  }

  await executor.executeStep(
    {
      ...input,
      messages: [...input.messages, toolCompleted.message],
      step: { type: "model" },
      stepIndex: 2,
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

test("Pi Engine Step and Continue resume the same durable Run", async () => {
  const faux = fauxProvider({ tokensPerSecond: 0 });
  const model = faux.getModel();
  faux.setResponses([
    fauxAssistantMessage(
      [fauxToolCall("increment", { amount: 2 }, { id: "call-engine-step" })],
      { stopReason: "toolUse" }
    ),
    fauxAssistantMessage("Finished."),
  ]);
  const models = createModels();
  models.setProvider(faux.provider);
  let executions = 0;
  const snapshot: AgentSnapshot = {
    schemaVersion: 1,
    agentId: "step-agent",
    generationId: "generation-1",
    model: `${model.provider}/${model.id}`,
    instructions: [],
    tools: [
      {
        name: "increment",
        description: "Increment",
        inputSchema: INCREMENT_SCHEMA,
      },
    ],
  };
  const executable: ExecutableAgent = {
    snapshot,
    tools: new Map([
      [
        "increment",
        {
          definition: {
            description: "Increment",
            inputSchema: INCREMENT_SCHEMA,
            execute() {
              executions++;
              return { count: executions };
            },
          },
        },
      ],
    ]),
  };
  const engine = createAgentEngine({
    store: new InMemoryEngineStore(),
    runExecutor: createPiRunExecutor({ models }),
    agentResolver: { resolve: () => Promise.resolve(executable) },
    createToolContext: ({ execution, signal }) =>
      _toolContext(execution, signal),
  });
  try {
    const thread = await engine.createThread();
    const run = await engine.startRun({
      threadId: thread.id,
      expectedHeadCheckpointId: thread.headCheckpointId,
      inputMessages: [
        {
          id: "user-engine-step",
          role: "user",
          content: [{ type: "text", text: "Increment" }],
        },
      ],
      agentSnapshot: snapshot,
      mode: "step",
    });

    await _waitForRunStatus(engine, run.id, "paused");
    expect(executions).toBe(0);

    await engine.stepRun({ runId: run.id, toolCallId: "call-engine-step" });
    await _waitForRunStatus(engine, run.id, "paused");
    expect(executions).toBe(1);

    await engine.continueRun(run.id);
    const completed = await _waitForRunStatus(engine, run.id, "completed");
    const result = await engine.getCheckpoint(completed.resultCheckpointId!);

    expect(completed.id).toBe(run.id);
    expect(result?.threadState.messages.at(-1)).toMatchObject({
      role: "assistant",
      content: [{ type: "text", text: "Finished." }],
    });
  } finally {
    await engine.close();
  }
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

  await executor.executeStep(
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
      step: { type: "model" },
      stepIndex: 0,
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

  const executor = createPiRunExecutor({ models });
  await _executeModelAndTools(
    executor,
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

  const executor = createPiRunExecutor({ models });
  await _executeModelAndTools(
    executor,
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
        executor.executeStep(
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
        executor.executeStep(_emptyRunInput(model, "run-length"), sink, {
          signal: new AbortController().signal,
        })
      )
    ).message
  ).toContain("output limit was reached");
});

test("Pi executor runs only the tool call selected by a Step command", async () => {
  const faux = fauxProvider({ tokensPerSecond: 0 });
  const model = faux.getModel();
  const models = createModels();
  models.setProvider(faux.provider);
  const executed: string[] = [];
  const events: RunExecutionEvent[] = [];
  const input = _emptyRunInput(model, "run-selected-tool");

  await createPiRunExecutor({ models }).executeStep(
    {
      ...input,
      messages: [
        ...input.messages,
        {
          id: "assistant-selected-tool",
          role: "assistant",
          content: [],
          toolCalls: [
            { id: "call-a", input: { name: "a", arguments: {} } },
            { id: "call-b", input: { name: "b", arguments: {} } },
          ],
        },
      ],
      agent: {
        snapshot: {
          ...input.agent.snapshot,
          tools: [
            { name: "a", description: "A", inputSchema: {} },
            { name: "b", description: "B", inputSchema: {} },
          ],
        },
        tools: new Map(
          ["a", "b"].map((name) => [
            name,
            {
              definition: {
                description: name,
                inputSchema: {},
                execute() {
                  executed.push(name);
                  return name;
                },
              },
            },
          ])
        ),
      },
      step: { type: "tools", toolCallIds: ["call-b"] },
      stepIndex: 1,
    },
    {
      accept(event) {
        events.push(event);
        return Promise.resolve();
      },
    },
    { signal: new AbortController().signal }
  );

  expect(executed).toEqual(["b"]);
  expect(
    events.some(
      (event) =>
        event.type === "tool.completed" && event.toolCallId === "call-b"
    )
  ).toBe(true);
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
  let requested: Extract<RunExecutionEvent, { type: "assistant.completed" }>[
    "message"
  ] | undefined;
  let completedTool: Extract<RunExecutionEvent, { type: "tool.completed" }>[
    "message"
  ] | undefined;
  const input: RunExecutionInput = {
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
      step: { type: "model" },
      stepIndex: 0,
      maxModelTurns: 4,
      createMessageId: () => `assistant-barrier-${assistantCount}`,
      createToolContext: ({ execution: contextExecution, signal }) =>
        _toolContext(contextExecution, signal),
    };

  let modelResolved = false;
  const modelExecution = executor.executeStep(
    input,
    {
      async accept(event) {
        if (event.type === "assistant.completed") {
          requested = event.message;
          assistantCount++;
          assistantReached.resolve();
          await releaseCheckpoint.promise;
        }
      },
    },
    { signal: new AbortController().signal }
  );
  void modelExecution.then(() => {
    modelResolved = true;
  });

  await assistantReached.promise;
  expect(toolStarted).toBeFalse();
  expect(modelResolved).toBeFalse();
  releaseCheckpoint.resolve();
  await modelExecution;
  expect(secondModelStarted).toBeFalse();
  if (requested === undefined) throw new Error("Model step did not complete.");

  let toolResolved = false;
  const toolExecution = executor.executeStep(
    {
      ...input,
      messages: [...input.messages, requested],
      step: { type: "tools", toolCallIds: ["call-barrier"] },
      stepIndex: 1,
    },
    {
      async accept(event) {
        if (event.type === "tool.completed") {
          completedTool = event.message;
          toolReached.resolve();
          await releaseToolCheckpoint.promise;
        }
      },
    },
    { signal: new AbortController().signal }
  );
  void toolExecution.then(() => {
    toolResolved = true;
  });

  await toolReached.promise;
  expect(toolStarted).toBeTrue();
  expect(toolResolved).toBeFalse();
  expect(secondModelStarted).toBeFalse();
  releaseToolCheckpoint.resolve();
  await toolExecution;
  if (completedTool === undefined) throw new Error("Tool step did not complete.");

  await executor.executeStep(
    {
      ...input,
      messages: [...input.messages, completedTool],
      step: { type: "model" },
      stepIndex: 2,
    },
    { accept: () => Promise.resolve() },
    { signal: new AbortController().signal }
  );
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
    step: { type: "model" },
    stepIndex: 0,
    maxModelTurns: 4,
    createMessageId: () => `assistant-${runId}`,
    createToolContext: ({ execution, signal }) =>
      _toolContext(execution, signal),
  };
}

/** Runs the two explicit steps used by tool-focused adapter tests. */
async function _executeModelAndTools(
  executor: RunExecutor,
  input: RunExecutionInput,
  sink: RunExecutionSink,
  options: { readonly signal: AbortSignal }
): Promise<void> {
  let requested: Extract<RunExecutionEvent, { type: "assistant.completed" }>[
    "message"
  ] | undefined;
  await executor.executeStep(
    { ...input, step: { type: "model" } },
    {
      async accept(event) {
        if (event.type === "assistant.completed") requested = event.message;
        await sink.accept(event);
      },
    },
    options
  );
  if (requested === undefined) {
    throw new Error("Model step did not request a tool.");
  }
  const toolCallIds = requested.toolCalls?.map((call) => call.id) ?? [];
  if (toolCallIds.length === 0) {
    throw new Error(`Model step did not request a tool: ${JSON.stringify(requested)}`);
  }
  await executor.executeStep(
    {
      ...input,
      messages: [...input.messages, requested],
      step: { type: "tools", toolCallIds },
      stepIndex: input.stepIndex + 1,
    },
    sink,
    options
  );
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

async function _waitForRunStatus(
  engine: AgentEngine,
  runId: string,
  status: import("@llm-space/engine").RunStatus
) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const run = await engine.getRun(runId);
    if (run?.status === status) return run;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error(`Run "${runId}" did not reach status "${status}".`);
}
