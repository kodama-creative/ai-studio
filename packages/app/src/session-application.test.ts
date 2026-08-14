import { describe, expect, test } from "bun:test";

import {
  createAgentEngine,
  type AgentEngine,
  type AgentSnapshot,
  type ExecutableAgent,
  InMemoryEngineStore,
  type RunExecutor,
} from "@llm-space/engine";

import { createSessionApplication } from "./session-application";
import {
  type ApplicationStore,
  type ApplicationStoreTransaction,
  InMemoryApplicationStore,
} from "./storage";
import { createSqliteApplicationStore } from "./storage/sqlite";

const AGENT: AgentSnapshot = {
  schemaVersion: 1,
  agentId: "agent-1",
  generationId: "generation-1",
  model: "test/model",
  instructions: [],
  tools: [],
};

describe.each([
  ["memory", () => new InMemoryApplicationStore()],
  ["sqlite", () => createSqliteApplicationStore({ path: ":memory:" })],
] as const)("SessionApplication with %s storage", (_name, createStore) => {
  test("projects Run completion without a UI stream subscriber", async () => {
    const engine = _engine();
    const application = createSessionApplication({
      engine,
      store: createStore(),
    });
    try {
      const session = await application.createSession({
        agentId: AGENT.agentId,
      });
      const other = await application.createSession({
        agentId: AGENT.agentId,
      });
      const task = await application.createTask({
        sessionId: session.id,
        title: "Background projection",
      });
      const run = await application.startRun({
        sessionId: session.id,
        taskId: task.id,
        message: {
          id: "user-background",
          role: "user",
          content: [{ type: "text", text: "Run without UI" }],
        },
        agentSnapshot: AGENT,
      });

      await _waitUntil(async () => {
        const messages = await application.listMessages(session.id);
        const tasks = await application.listTasks(session.id);
        return messages.length === 2 && tasks[0]?.status === "completed";
      });

      expect(await application.listRuns(session.id)).toMatchObject([
        { id: run.id, status: "completed" },
      ]);
      expect(await application.listRuns(other.id)).toEqual([]);
      expect(application.cancelRun(other.id, run.id)).rejects.toThrow(
        `Run "${run.id}" does not belong to Session "${other.id}".`
      );
      expect(await application.listMessages(session.id)).toMatchObject([
        { message: { id: "user-background", role: "user" } },
        { runId: run.id, message: { role: "assistant" } },
      ]);
    } finally {
      await application.close();
    }
  });

  test("records system and user-action messages outside model context", async () => {
    const application = createSessionApplication({
      engine: _engine(),
      store: createStore(),
    });
    try {
      const session = await application.createSession({
        agentId: AGENT.agentId,
      });

      await application.recordSystemMessage({
        sessionId: session.id,
        code: "permission.changed",
        text: "Workspace access changed.",
      });
      await application.recordUserAction({
        sessionId: session.id,
        action: "artifact.opened",
        detail: "report.md",
      });

      expect(await application.listMessages(session.id)).toMatchObject([
        {
          type: "system",
          code: "permission.changed",
          text: "Workspace access changed.",
        },
        {
          type: "user-action",
          action: "artifact.opened",
          detail: "report.md",
        },
      ]);
    } finally {
      await application.close();
    }
  });

  test("reuses a completed Run when operationId and command input match", async () => {
    const application = createSessionApplication({
      engine: _engine(),
      store: createStore(),
    });
    try {
      const session = await application.createSession({
        agentId: AGENT.agentId,
      });
      const input = {
        sessionId: session.id,
        message: {
          id: "user-idempotent",
          role: "user" as const,
          content: [{ type: "text" as const, text: "Run once" }],
        },
        agentSnapshot: AGENT,
        operationId: "operation-idempotent",
      };

      const first = await application.startRun(input);
      const duplicate = await application.startRun(input);

      expect(duplicate.id).toBe(first.id);
      expect(await application.listRuns(session.id)).toHaveLength(1);
      expect(
        application.startRun({
          ...input,
          message: {
            ...input.message,
            content: [{ type: "text", text: "Different input" }],
          },
        })
      ).rejects.toThrow("reused with different Application input");
    } finally {
      await application.close();
    }
  });

  test("projects Run output into durable Session history and retries on a child Thread", async () => {
    const engine = _engine();
    const application = createSessionApplication({
      engine,
      store: createStore(),
    });
    try {
      const session = await application.createSession({
        title: "Research",
        agentId: AGENT.agentId,
      });
      const task = await application.createTask({
        sessionId: session.id,
        title: "Answer once",
      });
      const run = await application.startRun({
        sessionId: session.id,
        taskId: task.id,
        message: {
          id: "user-1",
          role: "user",
          content: [{ type: "text", text: "Hello" }],
        },
        agentSnapshot: AGENT,
      });
      await _consume(
        application.streamRun(session.id, run.id, { follow: true })
      );

      expect(await application.listMessages(session.id)).toMatchObject([
        { type: "model", message: { id: "user-1", role: "user" } },
        {
          type: "model",
          runId: run.id,
          message: {
            role: "assistant",
            content: [{ type: "text", text: "Done." }],
          },
        },
      ]);
      expect(await application.listTasks(session.id)).toMatchObject([
        { id: task.id, status: "completed" },
      ]);

      const root = await engine.getThread(session.threadId);
      if (root === undefined) throw new Error("Root Thread disappeared.");
      await engine.commitThreadState({
        threadId: root.id,
        expectedHeadCheckpointId: root.headCheckpointId,
        threadState: { messages: [], state: { compacted: true } },
      });
      expect(await application.listMessages(session.id)).toHaveLength(2);

      const retry = await application.retryTaskRun({
        sessionId: session.id,
        taskId: task.id,
        runId: run.id,
      });
      expect(retry.threadId).not.toBe(session.threadId);
      expect((await application.getSession(session.id))?.threadId).toBe(
        retry.threadId
      );
      await _consume(
        application.streamRun(session.id, retry.id, { follow: true })
      );
      expect(await application.listTasks(session.id)).toMatchObject([
        { id: task.id, status: "completed" },
      ]);
    } finally {
      await application.close();
    }
  });

  test("an old Run replay cannot overwrite a retrying Task", async () => {
    const retryStarted = _deferred<void>();
    let turn = 0;
    const engine = _engine({
      runExecutor: {
        async executeStep(input, sink, { signal }) {
          turn++;
          if (turn === 1) {
            await sink.accept({
              type: "assistant.completed",
              message: {
                id: input.createMessageId(),
                role: "assistant",
                content: [],
              },
            });
            return;
          }
          retryStarted.resolve();
          await _waitForAbort(signal);
        },
      },
    });
    const application = createSessionApplication({
      engine,
      store: createStore(),
    });
    try {
      const session = await application.createSession({
        agentId: AGENT.agentId,
      });
      const task = await application.createTask({
        sessionId: session.id,
        title: "Retry safely",
      });
      const original = await application.startRun({
        sessionId: session.id,
        taskId: task.id,
        message: {
          id: "user-retry",
          role: "user",
          content: [{ type: "text", text: "Retry me" }],
        },
        agentSnapshot: AGENT,
      });
      await _consume(
        application.streamRun(session.id, original.id, { follow: true })
      );
      const retry = await application.retryTaskRun({
        sessionId: session.id,
        taskId: task.id,
        runId: original.id,
      });
      await retryStarted.promise;

      await _consume(application.streamRun(session.id, original.id));

      expect(await application.listTasks(session.id)).toMatchObject([
        { id: task.id, status: "running" },
      ]);
      await application.cancelRun(session.id, retry.id);
    } finally {
      await application.close();
    }
  });

  test("projects synthetic tool output when a running Run is cancelled", async () => {
    const toolStarted = _deferred<void>();
    const toolAgent: AgentSnapshot = {
      ...AGENT,
      tools: [
        {
          name: "side_effect",
          description: "A potentially side-effecting tool",
          inputSchema: {},
        },
      ],
    };
    const executableAgent: ExecutableAgent = {
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
    };
    const engine = _engine({
      executableAgent,
      runExecutor: _blockingToolRunExecutor("side_effect", "call-side-effect"),
    });
    const application = createSessionApplication({
      engine,
      store: createStore(),
    });
    try {
      const session = await application.createSession({
        agentId: toolAgent.agentId,
      });
      const task = await application.createTask({
        sessionId: session.id,
        title: "Cancel side effect",
      });
      const run = await application.startRun({
        sessionId: session.id,
        taskId: task.id,
        message: {
          id: "user-cancel-tool",
          role: "user",
          content: [{ type: "text", text: "Start tool" }],
        },
        agentSnapshot: toolAgent,
      });
      await toolStarted.promise;

      await application.cancelRun(session.id, run.id);
      await _waitUntil(async () => {
        const messages = await application.listMessages(session.id);
        const tasks = await application.listTasks(session.id);
        const assistant = messages
          .filter((message) => message.type === "model")
          .map((message) => message.message)
          .find((message) => message.role === "assistant");
        return (
          tasks[0]?.status === "cancelled" &&
          assistant?.role === "assistant" &&
          assistant.toolCalls?.[0]?.output?.isError === true
        );
      });

      expect(await application.listMessages(session.id)).toMatchObject([
        { message: { role: "user" } },
        {
          message: {
            role: "assistant",
            toolCalls: [{ output: { isError: true } }],
          },
        },
      ]);
    } finally {
      await application.close();
    }
  });
});

test("recovers a Run whose Application link transaction was interrupted", async () => {
  const engine = _engine();
  const store = new FailingRunLinkApplicationStore();
  const first = createSessionApplication({ engine, store });
  const session = await first.createSession({ agentId: AGENT.agentId });
  store.failNextRunLink = true;

  expect(
    first.startRun({
      sessionId: session.id,
      message: {
        id: "user-orphan-recovery",
        role: "user",
        content: [{ type: "text", text: "Recover association" }],
      },
      agentSnapshot: AGENT,
      operationId: "operation-app-recovery",
    })
  ).rejects.toThrow("Simulated Application link failure.");

  const recovered = createSessionApplication({ engine, store });
  try {
    await _waitUntil(async () => {
      const runs = await recovered.listRuns(session.id);
      const messages = await recovered.listMessages(session.id);
      return runs.length === 1 && messages.length === 2;
    });

    expect(await recovered.listRuns(session.id)).toMatchObject([
      { operationId: "operation-app-recovery", status: "completed" },
    ]);
  } finally {
    await recovered.close();
  }
});

test("retries an interrupted Application link transaction in the same process", async () => {
  const engine = _engine();
  const store = new FailingRunLinkApplicationStore();
  const application = createSessionApplication({ engine, store });
  const session = await application.createSession({ agentId: AGENT.agentId });
  const input = {
    sessionId: session.id,
    message: {
      id: "user-same-process-recovery",
      role: "user" as const,
      content: [{ type: "text" as const, text: "Resume association" }],
    },
    agentSnapshot: AGENT,
    operationId: "operation-same-process-recovery",
  };
  store.failNextRunLink = true;

  expect(application.startRun(input)).rejects.toThrow(
    "Simulated Application link failure."
  );

  try {
    const resumed = await application.startRun(input);
    expect(resumed.operationId).toBe(input.operationId);
    expect(await application.listRuns(session.id)).toHaveLength(1);
  } finally {
    await application.close();
  }
});

test("isolates a malformed Run intent while recovering other Sessions", async () => {
  const engine = _engine();
  const store = new InMemoryApplicationStore();
  const badThread = await engine.createThread();
  await engine.startRun({
    threadId: badThread.id,
    expectedHeadCheckpointId: badThread.headCheckpointId,
    inputMessages: [
      {
        id: "user-bad-intent",
        role: "user",
        content: [{ type: "text", text: "Missing Session" }],
      },
    ],
    agentSnapshot: AGENT,
    operationId: "operation-bad-intent",
  });
  const validThread = await engine.createThread();
  const validRun = await engine.startRun({
    threadId: validThread.id,
    expectedHeadCheckpointId: validThread.headCheckpointId,
    inputMessages: [
      {
        id: "user-valid-intent",
        role: "user",
        content: [{ type: "text", text: "Valid Session" }],
      },
    ],
    agentSnapshot: AGENT,
    operationId: "operation-valid-intent",
  });
  store.transaction((tx) => {
    tx.insertSession({
      schemaVersion: 1,
      id: "session-valid-intent",
      threadId: validThread.id,
      agentId: AGENT.agentId,
      title: "Valid recovery",
      status: "active",
      createdAt: 1,
      updatedAt: 1,
    });
    tx.insertRunIntent({
      schemaVersion: 1,
      operationId: "operation-bad-intent",
      sessionId: "session-missing",
      type: "start",
      message: {
        id: "user-bad-intent",
        role: "user",
        content: [{ type: "text", text: "Missing Session" }],
      },
      createdAt: 1,
    });
    tx.insertRunIntent({
      schemaVersion: 1,
      operationId: "operation-valid-intent",
      sessionId: "session-valid-intent",
      type: "start",
      message: {
        id: "user-valid-intent",
        role: "user",
        content: [{ type: "text", text: "Valid Session" }],
      },
      createdAt: 2,
    });
  });

  const recovered = createSessionApplication({ engine, store });
  try {
    expect(await recovered.listRuns("session-valid-intent")).toMatchObject([
      { id: validRun.id },
    ]);
    expect(store.transaction((tx) => tx.listRunIntents())).toMatchObject([
      { operationId: "operation-bad-intent" },
    ]);
  } finally {
    await recovered.close();
  }
});

function _engine(
  options: {
    readonly runExecutor?: RunExecutor;
    readonly executableAgent?: ExecutableAgent;
  } = {}
): AgentEngine {
  return createAgentEngine({
    store: new InMemoryEngineStore(),
    runExecutor: options.runExecutor ?? _textRunExecutor("Done."),
    agentResolver: {
      resolve(snapshot) {
        return Promise.resolve(
          options.executableAgent ?? { snapshot, tools: new Map() }
        );
      },
    },
    createToolContext: ({ execution, signal }) => ({
      execution,
      abortSignal: signal,
      getSandbox() {
        throw new Error("No sandbox in Application tests.");
      },
      getSkill() {
        throw new Error("No skills in Application tests.");
      },
      getToken() {
        return Promise.reject(new Error("No auth in Application tests."));
      },
      requireAuth() {
        throw new Error("No auth in Application tests.");
      },
    }),
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

async function _consume(values: AsyncIterable<unknown>): Promise<void> {
  for await (const value of values) void value;
}

async function _waitUntil(predicate: () => Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Condition was not met before the test deadline.");
}

function _deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

function _waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(_abortReason(signal));
  return new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(_abortReason(signal)), {
      once: true,
    });
  });
}

function _abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error("Aborted.");
}

class FailingRunLinkApplicationStore implements ApplicationStore {
  private readonly _inner = new InMemoryApplicationStore();
  failNextRunLink = false;

  transaction<T>(fn: (tx: ApplicationStoreTransaction) => T): T {
    return this._inner.transaction((tx) =>
      fn(
        new Proxy(tx, {
          get: (target, property) => {
            if (property === "insertRunLink") {
              return (...args: Parameters<typeof target.insertRunLink>) => {
                if (this.failNextRunLink) {
                  this.failNextRunLink = false;
                  throw new Error("Simulated Application link failure.");
                }
                return target.insertRunLink(...args);
              };
            }
            const value: unknown = Reflect.get(target, property);
            if (typeof value !== "function") return value;
            return (...args: unknown[]): unknown =>
              Reflect.apply(value, target, args) as unknown;
          },
        })
      )
    );
  }

  close(): void {
    this._inner.close();
  }
}
