import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { defineState } from "@llm-space/agent/context";
import type { JsonObject, ToolContext } from "@llm-space/agent/tools";
import type { Message } from "@llm-space/core";

import type { AgentSnapshot, ExecutableAgent } from "../domain";
import type { RunExecutor } from "../execution";
import type { EngineStore } from "../storage";
import { InMemoryEngineStore } from "../storage";
import { createSqliteEngineStore } from "../storage/sqlite";

import { createAgentEngine, type AgentEngine } from "./agent-engine";

const COUNTER_STATE = defineState<number>("test.counter", () => 0);
const INCREMENT_SCHEMA: JsonObject = {
  type: "object",
  properties: { amount: { type: "number" } },
  required: ["amount"],
  additionalProperties: false,
};

const TEST_AGENT: AgentSnapshot = {
  schemaVersion: 1,
  agentId: "test-agent",
  generationId: "generation-1",
  model: "test/model",
  instructions: ["Answer the user."],
  tools: [],
};

const RICH_USER_MESSAGE: Message = {
  id: "user-1",
  role: "user",
  content: [
    { type: "text", text: "What is in this image?" },
    { type: "image", mimeType: "image/png", data: "aW1hZ2U=" },
  ],
};

describe.each([
  ["memory", () => new InMemoryEngineStore()],
  ["sqlite", () => createSqliteEngineStore({ path: ":memory:" })],
] as const)(
  "AgentEngine thread contract with %s storage",
  (_name, createStore) => {
    test("creates, commits, and forks immutable Thread checkpoints", async () => {
      const engine = _createEngine(createStore());
      try {
        const root = await engine.createThread({
          initialState: { messages: [RICH_USER_MESSAGE], state: { count: 1 } },
        });
        const created = await engine.getCheckpoint(root.headCheckpointId);

        expect(created?.threadState).toEqual({
          messages: [RICH_USER_MESSAGE],
          state: { count: 1 },
        });

        const committed = await engine.commitThreadState({
          threadId: root.id,
          expectedHeadCheckpointId: root.headCheckpointId,
          threadState: {
            messages: [
              RICH_USER_MESSAGE,
              {
                id: "assistant-1",
                role: "assistant",
                content: [{ type: "text", text: "A test image." }],
                thinking: "Inspecting pixels",
              },
            ],
            state: { count: 2 },
          },
        });
        const fork = await engine.forkThread({
          threadId: root.id,
          checkpointId: committed.id,
        });
        const forkCheckpoint = await engine.getCheckpoint(
          fork.headCheckpointId
        );

        expect(fork.parent).toEqual({
          threadId: root.id,
          relationship: "fork",
          sourceCheckpointId: committed.id,
        });
        expect(forkCheckpoint?.sequence).toBe(1);
        expect(forkCheckpoint?.threadState).toEqual(committed.threadState);
        expect(
          (await engine.listCheckpoints(root.id)).map(
            ({ sequence }) => sequence
          )
        ).toEqual([1, 2]);
      } finally {
        await engine.close();
      }
    });

    test("expired Run claim rejects a stale lease snapshot", () => {
      const store = createStore();
      try {
        const checkpoint = {
          schemaVersion: 1 as const,
          id: "checkpoint-lease",
          threadId: "thread-lease",
          sequence: 1,
          source: { type: "thread.created" as const },
          threadState: { messages: [], state: {} },
          createdAt: 1,
        };
        const thread = {
          schemaVersion: 1 as const,
          id: checkpoint.threadId,
          headCheckpointId: checkpoint.id,
          createdAt: 1,
          updatedAt: 1,
        };
        const run = {
          schemaVersion: 1 as const,
          id: "run-lease",
          threadId: thread.id,
          operationId: "operation-lease",
          inputMessages: [RICH_USER_MESSAGE],
          baseCheckpointId: checkpoint.id,
          inputCheckpointId: checkpoint.id,
          agentSnapshot: TEST_AGENT,
          control: { mode: "continue" as const },
          status: "running" as const,
          workerId: "worker-original",
          leaseExpiresAt: 10,
          createdAt: 1,
          startedAt: 1,
        };
        store.transaction((tx) => {
          tx.insertThread(thread);
          tx.insertCheckpoint(checkpoint);
          tx.insertRun(run);
        });
        const stale = store.transaction(
          (tx) => tx.listExpiredRunningRuns(10)[0]
        );
        store.transaction((tx) => tx.saveRun({ ...run, leaseExpiresAt: 100 }));

        const claimed = store.transaction((tx) =>
          tx.claimExpiredRun({
            runId: run.id,
            expectedWorkerId: stale?.workerId,
            expectedLeaseExpiresAt: stale?.leaseExpiresAt ?? 0,
            workerId: "worker-recovery",
            now: 10,
            leaseExpiresAt: 40,
          })
        );

        expect(stale).toBeDefined();
        expect(claimed).toBeUndefined();
        expect(store.transaction((tx) => tx.getRun(run.id))).toMatchObject({
          workerId: "worker-original",
          leaseExpiresAt: 100,
          status: "running",
        });
      } finally {
        store.close();
      }
    });
  }
);

test("startRun atomically commits input and enforces one active writer", async () => {
  const turnStarted = _deferred<void>();
  const engine = _createEngine(new InMemoryEngineStore(), {
    runExecutor: {
      async executeStep(_input, _sink, { signal }) {
        turnStarted.resolve();
        await _waitForAbort(signal);
      },
    },
  });
  try {
    const thread = await engine.createThread();
    const run = await engine.startRun({
      threadId: thread.id,
      expectedHeadCheckpointId: thread.headCheckpointId,
      inputMessages: [RICH_USER_MESSAGE],
      agentSnapshot: TEST_AGENT,
      operationId: "operation-1",
    });
    await turnStarted.promise;

    const advancedThread = await engine.getThread(thread.id);
    const inputCheckpoint = await engine.getCheckpoint(run.inputCheckpointId);
    expect(run.status).toBe("queued");
    expect(advancedThread?.headCheckpointId).toBe(run.inputCheckpointId);
    expect(inputCheckpoint?.source).toEqual({
      type: "run.input",
      runId: run.id,
    });
    expect(inputCheckpoint?.threadState.messages).toEqual([RICH_USER_MESSAGE]);
    expect(
      (
        await engine.startRun({
          threadId: thread.id,
          expectedHeadCheckpointId: thread.headCheckpointId,
          inputMessages: [RICH_USER_MESSAGE],
          agentSnapshot: TEST_AGENT,
          operationId: "operation-1",
        })
      ).id
    ).toBe(run.id);

    expect(() =>
      engine.startRun({
        threadId: thread.id,
        expectedHeadCheckpointId: thread.headCheckpointId,
        inputMessages: [
          {
            id: "user-operation-conflict",
            role: "user",
            content: [{ type: "text", text: "Different command" }],
          },
        ],
        agentSnapshot: TEST_AGENT,
        operationId: "operation-1",
      })
    ).toThrow('Run operation "operation-1" was reused');

    let secondRunError: unknown;
    try {
      await engine.startRun({
        threadId: thread.id,
        expectedHeadCheckpointId: run.inputCheckpointId,
        inputMessages: [
          {
            id: "user-2",
            role: "user",
            content: [{ type: "text", text: "Again" }],
          },
        ],
        agentSnapshot: TEST_AGENT,
      });
    } catch (error) {
      secondRunError = error;
    }
    expect(secondRunError).toBeInstanceOf(Error);
    expect((secondRunError as Error).message).toContain(
      "already has an active Run"
    );

    await engine.cancelRun(run.id);
    expect((await _waitForTerminalRun(engine, run.id)).status).toBe(
      "cancelled"
    );
  } finally {
    await engine.close();
  }
});

test("rejects a resolver result whose full Agent snapshot changed", async () => {
  let modelStarted = false;
  const engine = _createEngine(new InMemoryEngineStore(), {
    executableAgent: {
      snapshot: { ...TEST_AGENT, instructions: ["Changed instructions."] },
      tools: new Map(),
    },
    runExecutor: {
      executeStep() {
        modelStarted = true;
        return Promise.resolve();
      },
    },
  });
  try {
    const thread = await engine.createThread();
    const run = await engine.startRun({
      threadId: thread.id,
      expectedHeadCheckpointId: thread.headCheckpointId,
      inputMessages: [RICH_USER_MESSAGE],
      agentSnapshot: TEST_AGENT,
    });

    const terminal = await _waitForTerminalRun(engine, run.id);

    expect(modelStarted).toBeFalse();
    expect(terminal.status).toBe("failed");
    expect(terminal.error?.message).toContain(
      `Agent generation "${TEST_AGENT.agentId}/${TEST_AGENT.generationId}" is unavailable.`
    );
  } finally {
    await engine.close();
  }
});

test("fails closed when a custom resolver returns an approval-gated tool", async () => {
  let executorStarted = false;
  const snapshot: AgentSnapshot = {
    ...TEST_AGENT,
    tools: [
      {
        name: "guarded",
        description: "Requires approval",
        inputSchema: {},
      },
    ],
  };
  const engine = _createEngine(new InMemoryEngineStore(), {
    executableAgent: {
      snapshot,
      tools: new Map([
        [
          "guarded",
          {
            definition: {
              description: "Requires approval",
              inputSchema: {},
              approval: () => "user-approval",
              execute: () => "must not execute",
            },
          },
        ],
      ]),
    },
    runExecutor: {
      executeStep() {
        executorStarted = true;
        return Promise.resolve();
      },
    },
  });
  try {
    const thread = await engine.createThread();
    const run = await engine.startRun({
      threadId: thread.id,
      expectedHeadCheckpointId: thread.headCheckpointId,
      inputMessages: [RICH_USER_MESSAGE],
      agentSnapshot: snapshot,
    });

    const terminal = await _waitForTerminalRun(engine, run.id);

    expect(executorStarted).toBeFalse();
    expect(terminal.status).toBe("failed");
    expect(terminal.error?.message).toBe(
      'Tool approval for "guarded" is not supported by Engine v1.'
    );
  } finally {
    await engine.close();
  }
});

test("persists a complete Run through the high-level RunExecutor seam", async () => {
  const runExecutor: RunExecutor = {
    async executeStep(input, sink) {
      const message = {
        id: input.createMessageId(),
        role: "assistant" as const,
        content: [{ type: "text" as const, text: "Executed by backend." }],
      };
      await sink.accept({
        type: "assistant.delta",
        message,
        textDelta: "Executed by backend.",
      });
      await sink.accept({ type: "assistant.completed", message });
    },
  };
  const engine = createAgentEngine({
    store: new InMemoryEngineStore(),
    runExecutor,
    agentResolver: {
      resolve(snapshot) {
        return Promise.resolve({ snapshot, tools: new Map() });
      },
    },
    createToolContext: _createToolContext,
  });
  try {
    const thread = await engine.createThread();
    const run = await engine.startRun({
      threadId: thread.id,
      expectedHeadCheckpointId: thread.headCheckpointId,
      inputMessages: [RICH_USER_MESSAGE],
      agentSnapshot: TEST_AGENT,
    });

    const completed = await _waitForTerminalRun(engine, run.id);
    const result = await engine.getCheckpoint(completed.resultCheckpointId!);

    expect(completed.status).toBe("completed");
    expect(result?.threadState.messages.at(-1)).toMatchObject({
      role: "assistant",
      content: [{ type: "text", text: "Executed by backend." }],
    });
  } finally {
    await engine.close();
  }
});

test("step pauses one Run and continue resumes it from the durable head", async () => {
  const modelOverrides: (string | undefined)[] = [];
  const runExecutor: RunExecutor = {
    async executeStep(input, sink) {
      modelOverrides.push(input.modelOverride);
      const last = input.messages.at(-1);
      if (input.step.type === "tools") {
        const { toolCallIds } = input.step;
        const assistant = input.messages.findLast(
          (message) => message.role === "assistant"
        );
        if (assistant?.role !== "assistant") {
          throw new Error("A completed Assistant Message is required.");
        }
        const completed = {
          ...assistant,
          toolCalls: assistant.toolCalls?.map((call) =>
            toolCallIds.includes(call.id)
              ? {
                  ...call,
                  output: {
                    content: [{ type: "text" as const, text: "tool result" }],
                    isError: false,
                  },
                }
              : call
          ),
        };
        for (const toolCallId of toolCallIds) {
          const call = assistant.toolCalls?.find(
            (candidate) => candidate.id === toolCallId
          );
          if (call === undefined) throw new Error("Tool call was not found.");
          await sink.accept({
            type: "tool.started",
            messageId: assistant.id,
            toolCallId,
            toolName: call.input.name,
          });
          await sink.accept({
            type: "tool.completed",
            messageId: assistant.id,
            toolCallId,
            message: completed,
          });
        }
        return;
      }
      const message =
        last?.role === "assistant"
          ? {
              id: input.createMessageId(),
              role: "assistant" as const,
              content: [{ type: "text" as const, text: "Finished." }],
            }
          : {
              id: input.createMessageId(),
              role: "assistant" as const,
              content: [],
              toolCalls: [
                {
                  id: "call-step",
                  input: { name: "lookup", arguments: {} },
                },
              ],
            };
      await sink.accept({ type: "assistant.completed", message });
    },
  };
  const engine = _createEngine(new InMemoryEngineStore(), { runExecutor });
  try {
    const thread = await engine.createThread();
    const started = await engine.startRun({
      threadId: thread.id,
      expectedHeadCheckpointId: thread.headCheckpointId,
      inputMessages: [RICH_USER_MESSAGE],
      agentSnapshot: TEST_AGENT,
      modelOverride: "override/model",
      mode: "step",
    });

    const paused = await _waitForRunStatus(engine, started.id, "paused");
    const pausedThread = await engine.getThread(thread.id);
    const pausedCheckpoint = await engine.getCheckpoint(
      pausedThread!.headCheckpointId
    );

    expect(paused.id).toBe(started.id);
    expect(paused.pause).toMatchObject({
      reason: "step.completed",
      step: "model.completed",
      checkpointId: pausedThread?.headCheckpointId,
    });
    const requested = pausedCheckpoint?.threadState.messages.at(-1);
    expect(requested).toMatchObject({
      role: "assistant",
      toolCalls: [{ id: "call-step" }],
    });
    expect(
      requested?.role === "assistant" && requested.toolCalls?.[0]?.output
    ).toBeUndefined();

    const resumed = await engine.continueRun(started.id);
    const completed = await _waitForTerminalRun(engine, started.id);
    const result = await engine.getCheckpoint(completed.resultCheckpointId!);

    expect(resumed.id).toBe(started.id);
    expect(completed.id).toBe(started.id);
    expect(completed.status).toBe("completed");
    expect(completed.control.modelOverride).toBe("override/model");
    expect(modelOverrides).toEqual([
      "override/model",
      "override/model",
      "override/model",
    ]);
    expect(result?.threadState.messages.at(-1)).toMatchObject({
      role: "assistant",
      content: [{ type: "text", text: "Finished." }],
    });
  } finally {
    await engine.close();
  }
});

test("retry preserves the requested Step execution mode", async () => {
  const engine = _createEngine(new InMemoryEngineStore());
  try {
    const thread = await engine.createThread();
    const original = await engine.startRun({
      threadId: thread.id,
      expectedHeadCheckpointId: thread.headCheckpointId,
      inputMessages: [RICH_USER_MESSAGE],
      agentSnapshot: TEST_AGENT,
    });
    await _waitForTerminalRun(engine, original.id);

    const retry = await engine.retryRun({
      runId: original.id,
      mode: "step",
    });

    expect(retry.retryOfRunId).toBe(original.id);
    expect(retry.control.mode).toBe("step");
  } finally {
    await engine.close();
  }
});

test("fails a RunExecutor that returns without a completed assistant", async () => {
  const engine = _createEngine(new InMemoryEngineStore(), {
    runExecutor: { executeStep: () => Promise.resolve() },
  });
  try {
    const thread = await engine.createThread();
    const run = await engine.startRun({
      threadId: thread.id,
      expectedHeadCheckpointId: thread.headCheckpointId,
      inputMessages: [RICH_USER_MESSAGE],
      agentSnapshot: TEST_AGENT,
    });

    const terminal = await _waitForTerminalRun(engine, run.id);

    expect(terminal.status).toBe("failed");
    expect(terminal.error?.message).toContain("no completed Assistant Message");
  } finally {
    await engine.close();
  }
});

test("fails a RunExecutor that returns with an unfinished tool call", async () => {
  const engine = _createEngine(new InMemoryEngineStore(), {
    runExecutor: {
      async executeStep(input, sink) {
        await sink.accept({
          type: "assistant.completed",
          message: {
            id: input.createMessageId(),
            role: "assistant",
            content: [],
            toolCalls: [
              { id: "call-unfinished", input: { name: "work", arguments: {} } },
            ],
          },
        });
      },
    },
  });
  try {
    const thread = await engine.createThread();
    const run = await engine.startRun({
      threadId: thread.id,
      expectedHeadCheckpointId: thread.headCheckpointId,
      inputMessages: [RICH_USER_MESSAGE],
      agentSnapshot: TEST_AGENT,
    });

    const terminal = await _waitForTerminalRun(engine, run.id);

    expect(terminal.status).toBe("failed");
    expect(terminal.error?.message).toContain(
      'left tool call "call-unfinished" unfinished'
    );
    const recoveredThread = await engine.getThread(thread.id);
    const recovered = await engine.getCheckpoint(
      recoveredThread?.headCheckpointId ?? "missing"
    );
    expect(recovered?.source).toEqual({
      type: "run.recovery",
      runId: run.id,
    });
    expect(recovered?.threadState.messages.at(-1)).toMatchObject({
      role: "assistant",
      toolCalls: [
        {
          id: "call-unfinished",
          output: { isError: true },
        },
      ],
    });
  } finally {
    await engine.close();
  }
});

test("Run execution checkpoints core Messages and agent-defined JSON state", async () => {
  let observedExecution: ToolContext["execution"] | undefined;
  const toolAgent: AgentSnapshot = {
    ...TEST_AGENT,
    tools: [
      {
        name: "increment",
        description: "Increment the durable counter",
        inputSchema: INCREMENT_SCHEMA,
      },
    ],
  };
  const engine = _createEngine(new InMemoryEngineStore(), {
    executableAgent: {
      snapshot: toolAgent,
      tools: new Map([
        [
          "increment",
          {
            definition: {
              description: "Increment the durable counter",
              inputSchema: INCREMENT_SCHEMA,
              execute(input, context) {
                observedExecution = context.execution;
                const amount = input as { amount: number };
                COUNTER_STATE.update((current) => current + amount.amount);
                return { count: COUNTER_STATE.get() };
              },
            },
          },
        ],
      ]),
    },
    runExecutor: {
      async executeStep(input, sink, { signal }) {
        expect(input.messages).toEqual([RICH_USER_MESSAGE]);
        const messageId = input.createMessageId();
        const requested = {
          id: messageId,
          role: "assistant" as const,
          content: [],
          toolCalls: [
            {
              id: "call-1",
              input: { name: "increment", arguments: { amount: 2 } },
            },
          ],
        };
        await sink.accept({
          type: "assistant.completed",
          message: requested,
        });
        await sink.accept({
          type: "tool.started",
          messageId,
          toolCallId: "call-1",
          toolName: "increment",
        });
        const prepared = input.agent.tools.get("increment");
        if (prepared === undefined) throw new Error("increment was not found");
        const value = await prepared.definition.execute(
          { amount: 2 },
          input.createToolContext({
            execution: {
              sessionId: input.threadId,
              lane: "main",
              runId: input.runId,
              assistantEntryId: messageId,
              toolIndex: 0,
              toolCallId: "call-1",
              toolName: "increment",
              idempotencyKey: `${input.threadId}:main:${input.runId}:${messageId}:0`,
            },
            signal,
          })
        );
        const completedTool = {
          ...requested,
          toolCalls: [
            {
              ...requested.toolCalls[0]!,
              output: {
                content: [
                  { type: "text" as const, text: JSON.stringify(value) },
                ],
                isError: false,
              },
            },
          ],
        };
        await sink.accept({
          type: "tool.completed",
          messageId,
          toolCallId: "call-1",
          message: completedTool,
        });
        const answer = {
          id: input.createMessageId(),
          role: "assistant" as const,
          content: [{ type: "text" as const, text: "Counter is 2." }],
        };
        await sink.accept({
          type: "assistant.delta",
          message: answer,
          textDelta: "Counter is 2.",
        });
        await sink.accept({ type: "assistant.completed", message: answer });
      },
    },
  });
  try {
    const thread = await engine.createThread();
    const run = await engine.startRun({
      threadId: thread.id,
      expectedHeadCheckpointId: thread.headCheckpointId,
      inputMessages: [RICH_USER_MESSAGE],
      agentSnapshot: toolAgent,
    });
    const terminal = await _waitForTerminalRun(engine, run.id);
    const result = await engine.getCheckpoint(terminal.resultCheckpointId!);

    expect(terminal.status).toBe("completed");
    expect(result?.threadState.state).toEqual({ "test.counter": 2 });
    expect(result?.threadState.messages.at(-1)).toMatchObject({
      role: "assistant",
      content: [{ type: "text", text: "Counter is 2." }],
    });
    expect(observedExecution).toMatchObject({
      sessionId: thread.id,
      lane: "main",
      runId: run.id,
      toolCallId: "call-1",
      toolName: "increment",
    });
    expect(
      (await engine.listCheckpoints(thread.id)).map(
        (checkpoint) => checkpoint.source
      )
    ).toEqual([
      { type: "thread.created" },
      { type: "run.input", runId: run.id },
      { type: "run.step", runId: run.id, step: "model.completed" },
      { type: "run.step", runId: run.id, step: "tool.completed" },
      { type: "run.step", runId: run.id, step: "model.completed" },
    ]);
  } finally {
    await engine.close();
  }
});

test("retry creates a child Thread from the original base Checkpoint", async () => {
  const engine = _createEngine(new InMemoryEngineStore());
  try {
    const root = await engine.createThread({
      initialState: { messages: [], state: { preserved: true } },
    });
    const original = await engine.startRun({
      threadId: root.id,
      expectedHeadCheckpointId: root.headCheckpointId,
      inputMessages: [RICH_USER_MESSAGE],
      agentSnapshot: TEST_AGENT,
    });
    await _waitForTerminalRun(engine, original.id);

    expect(() =>
      engine.retryRun({
        runId: original.id,
        operationId: original.operationId,
      })
    ).toThrow(`Run operation "${original.operationId}" was reused`);

    const retry = await engine.retryRun({
      runId: original.id,
      operationId: "retry-operation",
    });
    expect(
      (
        await engine.retryRun({
          runId: original.id,
          operationId: "retry-operation",
        })
      ).id
    ).toBe(retry.id);
    const retryThread = await engine.getThread(retry.threadId);
    const retryInput = await engine.getCheckpoint(retry.inputCheckpointId);

    expect(retry.retryOfRunId).toBe(original.id);
    expect(retry.threadId).not.toBe(root.id);
    expect(retryThread?.parent).toEqual({
      threadId: root.id,
      relationship: "retry",
      sourceCheckpointId: original.baseCheckpointId,
    });
    expect(retry.inputMessages).toEqual(original.inputMessages);
    expect(retry.agentSnapshot).toEqual(original.agentSnapshot);
    expect(retryInput?.threadState).toEqual({
      messages: [RICH_USER_MESSAGE],
      state: { preserved: true },
    });
    await _waitForTerminalRun(engine, retry.id);
  } finally {
    await engine.close();
  }
});

test("streamRun reconnects from a durable output snapshot", async () => {
  const releaseTurn = _deferred<void>();
  const draftPersisted = _deferred<void>();
  const engine = _createEngine(new InMemoryEngineStore(), {
    runExecutor: {
      async executeStep(input, sink) {
        const messageId = input.createMessageId();
        await sink.accept({
          type: "assistant.delta",
          message: {
            id: messageId,
            role: "assistant",
            content: [{ type: "text", text: "durable " }],
          },
          textDelta: "durable ",
        });
        draftPersisted.resolve();
        await releaseTurn.promise;
        const answer = {
          id: messageId,
          role: "assistant" as const,
          content: [{ type: "text" as const, text: "durable answer" }],
        };
        await sink.accept({
          type: "assistant.delta",
          message: answer,
          textDelta: "answer",
        });
        await sink.accept({ type: "assistant.completed", message: answer });
      },
    },
  });
  try {
    const thread = await engine.createThread();
    const run = await engine.startRun({
      threadId: thread.id,
      expectedHeadCheckpointId: thread.headCheckpointId,
      inputMessages: [RICH_USER_MESSAGE],
      agentSnapshot: TEST_AGENT,
    });
    await draftPersisted.promise;

    const liveIterator = engine
      .streamRun(run.id, { follow: true })
      [Symbol.asyncIterator]();
    const first = await liveIterator.next();
    expect(first.value).toMatchObject({
      type: "snapshot",
      outputs: [
        {
          status: "streaming",
          message: { content: [{ type: "text", text: "durable " }] },
        },
      ],
    });
    releaseTurn.resolve();
    await _waitForTerminalRun(engine, run.id);

    const reconnect = engine.streamRun(run.id)[Symbol.asyncIterator]();
    const snapshot = await reconnect.next();
    expect(snapshot.value).toMatchObject({
      type: "snapshot",
      run: { status: "completed" },
      outputs: [
        {
          status: "completed",
          message: { content: [{ type: "text", text: "durable answer" }] },
        },
      ],
    });
    await liveIterator.return?.();
  } finally {
    await engine.close();
  }
});

test("Engine close releases stream followers before closing SQLite", async () => {
  const turnStarted = _deferred<void>();
  const engine = _createEngine(createSqliteEngineStore({ path: ":memory:" }), {
    runExecutor: {
      async executeStep(_input, _sink, { signal }) {
        turnStarted.resolve();
        await _waitForAbort(signal);
      },
    },
  });
  try {
    const thread = await engine.createThread();
    const run = await engine.startRun({
      threadId: thread.id,
      expectedHeadCheckpointId: thread.headCheckpointId,
      inputMessages: [RICH_USER_MESSAGE],
      agentSnapshot: TEST_AGENT,
    });
    await turnStarted.promise;
    const iterator = engine
      .streamRun(run.id, { follow: true })
      [Symbol.asyncIterator]();
    expect((await iterator.next()).value).toMatchObject({ type: "snapshot" });
    const follower = iterator.next();

    await engine.close();

    expect(await follower).toEqual({ done: true, value: undefined });
  } finally {
    await engine.close();
  }
});

test("Engine shutdown persists interrupted Run recovery with synthetic tool output", async () => {
  const root = await mkdtemp(join(tmpdir(), "llm-space-engine-recovery-"));
  const databasePath = join(root, "engine.sqlite");
  const toolStarted = _deferred<void>();
  const recoveryAgent: AgentSnapshot = {
    ...TEST_AGENT,
    tools: [
      {
        name: "side_effect",
        description: "A potentially side-effecting tool",
        inputSchema: {},
      },
    ],
  };
  try {
    const first = _createEngine(
      createSqliteEngineStore({ path: databasePath }),
      {
        executableAgent: {
          snapshot: recoveryAgent,
          tools: new Map([
            [
              "side_effect",
              {
                definition: {
                  description: "A potentially side-effecting tool",
                  inputSchema: {},
                  execute(_input, context) {
                    toolStarted.resolve();
                    return _waitForAbort(context.abortSignal);
                  },
                },
              },
            ],
          ]),
        },
        runExecutor: _blockingToolRunExecutor(
          "side_effect",
          "call-side-effect"
        ),
      }
    );
    const thread = await first.createThread();
    const run = await first.startRun({
      threadId: thread.id,
      expectedHeadCheckpointId: thread.headCheckpointId,
      inputMessages: [RICH_USER_MESSAGE],
      agentSnapshot: recoveryAgent,
    });
    const runId = run.id;
    const threadId = thread.id;
    await toolStarted.promise;
    await first.close();

    const reopened = _createEngine(
      createSqliteEngineStore({ path: databasePath })
    );
    try {
      const recoveredRun = await reopened.getRun(runId);
      const recoveredThread = await reopened.getThread(threadId);
      const recovered = await reopened.getCheckpoint(
        recoveredThread!.headCheckpointId
      );
      const assistant = recovered?.threadState.messages.at(-1);

      expect(recoveredRun?.status).toBe("interrupted");
      expect(recovered?.source).toEqual({ type: "run.recovery", runId });
      expect(assistant?.role).toBe("assistant");
      if (assistant?.role === "assistant") {
        const output = assistant.toolCalls?.[0]?.output;
        expect(output?.isError).toBe(true);
        expect(output?.content).toHaveLength(1);
        const content = output?.content[0];
        expect(content?.type).toBe("text");
        if (content?.type === "text") {
          expect(content.text).toContain("was not automatically retried");
        }
      }
    } finally {
      await reopened.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cancelling a running tool commits a synthetic tool output", async () => {
  const toolStarted = _deferred<void>();
  const toolAgent: AgentSnapshot = {
    ...TEST_AGENT,
    tools: [
      {
        name: "side_effect",
        description: "A potentially side-effecting tool",
        inputSchema: {},
      },
    ],
  };
  const engine = _createEngine(new InMemoryEngineStore(), {
    executableAgent: {
      snapshot: toolAgent,
      tools: new Map([
        [
          "side_effect",
          {
            definition: {
              description: "A potentially side-effecting tool",
              inputSchema: {},
              execute(_input, context) {
                toolStarted.resolve();
                return _waitForAbort(context.abortSignal);
              },
            },
          },
        ],
      ]),
    },
    runExecutor: _blockingToolRunExecutor("side_effect", "call-side-effect"),
  });
  try {
    const thread = await engine.createThread();
    const run = await engine.startRun({
      threadId: thread.id,
      expectedHeadCheckpointId: thread.headCheckpointId,
      inputMessages: [RICH_USER_MESSAGE],
      agentSnapshot: toolAgent,
    });
    await toolStarted.promise;

    await engine.cancelRun(run.id);
    const cancelled = await _waitForTerminalRun(engine, run.id);
    const recovered = await engine.getCheckpoint(cancelled.resultCheckpointId!);
    const assistant = recovered?.threadState.messages.at(-1);

    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.error).toBeUndefined();
    expect(recovered?.source).toEqual({ type: "run.recovery", runId: run.id });
    expect(assistant?.role).toBe("assistant");
    if (assistant?.role === "assistant") {
      expect(assistant.toolCalls?.[0]?.output).toMatchObject({
        isError: true,
      });
    }
    const snapshot = await engine
      .streamRun(run.id)
      [Symbol.asyncIterator]()
      .next();
    expect(snapshot.value).toMatchObject({
      type: "snapshot",
      outputs: [
        {
          status: "completed",
          message: {
            toolCalls: [{ output: { isError: true } }],
          },
        },
      ],
    });
  } finally {
    await engine.close();
  }
});

test("a different Worker requests cancellation without terminating the Run early", async () => {
  const store = new InMemoryEngineStore();
  const toolStarted = _deferred<void>();
  const toolAgent: AgentSnapshot = {
    ...TEST_AGENT,
    tools: [
      {
        name: "remote_side_effect",
        description: "A tool owned by another Worker",
        inputSchema: {},
      },
    ],
  };
  const owner = _createEngine(store, {
    workerLeaseMs: 300,
    executableAgent: {
      snapshot: toolAgent,
      tools: new Map([
        [
          "remote_side_effect",
          {
            definition: {
              description: "A tool owned by another Worker",
              inputSchema: {},
              execute(_input, context) {
                toolStarted.resolve();
                return _waitForAbort(context.abortSignal);
              },
            },
          },
        ],
      ]),
    },
    runExecutor: _blockingToolRunExecutor(
      "remote_side_effect",
      "call-remote-side-effect"
    ),
  });
  let requester: AgentEngine | undefined;
  try {
    const thread = await owner.createThread();
    const run = await owner.startRun({
      threadId: thread.id,
      expectedHeadCheckpointId: thread.headCheckpointId,
      inputMessages: [RICH_USER_MESSAGE],
      agentSnapshot: toolAgent,
    });
    await toolStarted.promise;
    requester = _createEngine(store, { workerLeaseMs: 300 });

    await requester.cancelRun(run.id);
    const cancelled = await _waitForTerminalRun(requester, run.id);
    const snapshot = await requester
      .streamRun(run.id)
      [Symbol.asyncIterator]()
      .next();

    expect(cancelled.status).toBe("cancelled");
    expect(snapshot.value).toMatchObject({
      outputs: [
        {
          message: { toolCalls: [{ output: { isError: true } }] },
        },
      ],
    });
  } finally {
    await requester?.close();
    await owner.close();
  }
});

test("a cross-Worker cancellation request wins a race with model completion", async () => {
  const store = new InMemoryEngineStore();
  const turnStarted = _deferred<void>();
  const releaseTurn = _deferred<void>();
  const owner = _createEngine(store, {
    workerLeaseMs: 300,
    runExecutor: {
      async executeStep(input, sink) {
        turnStarted.resolve();
        await releaseTurn.promise;
        await sink.accept({
          type: "assistant.completed",
          message: {
            id: input.createMessageId(),
            role: "assistant",
            content: [],
          },
        });
      },
    },
  });
  let requester: AgentEngine | undefined;
  try {
    const thread = await owner.createThread();
    const run = await owner.startRun({
      threadId: thread.id,
      expectedHeadCheckpointId: thread.headCheckpointId,
      inputMessages: [RICH_USER_MESSAGE],
      agentSnapshot: TEST_AGENT,
    });
    await turnStarted.promise;
    requester = _createEngine(store, { workerLeaseMs: 300 });

    await requester.cancelRun(run.id);
    releaseTurn.resolve();

    expect((await _waitForTerminalRun(requester, run.id)).status).toBe(
      "cancelled"
    );
  } finally {
    releaseTurn.resolve();
    await requester?.close();
    await owner.close();
  }
});

function _createEngine(
  store: EngineStore,
  options: {
    readonly runExecutor?: RunExecutor;
    readonly executableAgent?: ExecutableAgent;
    readonly workerLeaseMs?: number;
  } = {}
): AgentEngine {
  const runExecutor = options.runExecutor ?? _textRunExecutor("Done.");
  return createAgentEngine({
    store,
    runExecutor,
    agentResolver: {
      resolve(snapshot): Promise<ExecutableAgent> {
        return Promise.resolve(
          options.executableAgent ?? { snapshot, tools: new Map() }
        );
      },
    },
    createToolContext: _createToolContext,
    ...(options.workerLeaseMs === undefined
      ? {}
      : { workerLeaseMs: options.workerLeaseMs }),
  });
}

function _textRunExecutor(text: string): RunExecutor {
  return {
    async executeStep(input, sink) {
      const message = {
        id: input.createMessageId(),
        role: "assistant" as const,
        content: [{ type: "text" as const, text }],
      };
      await sink.accept({
        type: "assistant.delta",
        message,
        textDelta: text,
      });
      await sink.accept({ type: "assistant.completed", message });
    },
  };
}

function _blockingToolRunExecutor(
  toolName: string,
  toolCallId: string
): RunExecutor {
  return {
    async executeStep(input, sink, { signal }) {
      const message = {
        id: input.createMessageId(),
        role: "assistant" as const,
        content: [],
        toolCalls: [
          { id: toolCallId, input: { name: toolName, arguments: {} } },
        ],
      };
      await sink.accept({ type: "assistant.completed", message });
      await sink.accept({
        type: "tool.started",
        messageId: message.id,
        toolCallId,
        toolName,
      });
      const prepared = input.agent.tools.get(toolName);
      if (prepared === undefined) throw new Error(`${toolName} was not found`);
      await prepared.definition.execute(
        {},
        input.createToolContext({
          execution: {
            sessionId: input.threadId,
            lane: "main",
            runId: input.runId,
            assistantEntryId: message.id,
            toolIndex: 0,
            toolCallId,
            toolName,
            idempotencyKey: `${input.threadId}:main:${input.runId}:${message.id}:0`,
          },
          signal,
        })
      );
    },
  };
}

function _createToolContext(input: {
  readonly execution: ToolContext["execution"];
  readonly signal: AbortSignal;
}): ToolContext {
  return {
    execution: input.execution,
    abortSignal: input.signal,
    getSandbox() {
      throw new Error("Sandbox is unavailable in Engine tests.");
    },
    getSkill() {
      throw new Error("Skills are unavailable in Engine tests.");
    },
    getToken() {
      return Promise.reject(new Error("Auth is unavailable in Engine tests."));
    },
    requireAuth() {
      throw new Error("Auth is unavailable in Engine tests.");
    },
  };
}

async function _waitForTerminalRun(engine: AgentEngine, runId: string) {
  for await (const frame of engine.streamRun(runId, { follow: true })) {
    // Run frames wake this loop; the durable Run remains the source of truth.
    void frame;
  }
  const run = await engine.getRun(runId);
  if (run === undefined) throw new Error(`Run "${runId}" disappeared.`);
  return run;
}

async function _waitForRunStatus(
  engine: AgentEngine,
  runId: string,
  status: import("../domain").RunStatus
) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const run = await engine.getRun(runId);
    if (run?.status === status) return run;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error(`Run "${runId}" did not reach status "${status}".`);
}

function _deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

function _waitForAbort(signal: AbortSignal): Promise<void> {
  const abortError = () =>
    signal.reason instanceof Error
      ? signal.reason
      : new Error("Operation was aborted.");
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(abortError()), {
      once: true,
    });
  });
}
