import { describe, expect, test } from "bun:test";

import {
  createAgentEngine,
  type AgentSnapshot,
  InMemoryEngineStore,
  type RunExecutor,
} from "@llm-space/engine";

import {
  InMemoryStudioStore,
  type StudioStore,
  type StudioStoreTransaction,
} from "./storage";
import { createSqliteStudioStore } from "./storage/sqlite";
import { createStudioApplication } from "./studio-application";

const AGENT: AgentSnapshot = {
  schemaVersion: 1,
  agentId: "studio-agent",
  generationId: "generation-1",
  model: "test/model",
  instructions: ["Answer concisely."],
  tools: [],
};

describe.each([
  ["memory", () => new InMemoryStudioStore()],
  ["sqlite", () => createSqliteStudioStore({ path: ":memory:" })],
] as const)("StudioApplication with %s storage", (_name, createStore) => {
  test("stores dirty Drafts outside Engine and retries a prior Run on a child Thread", async () => {
    const engine = createAgentEngine({
      store: new InMemoryEngineStore(),
      runExecutor: _textRunExecutor("Studio answer"),
      agentResolver: {
        resolve(snapshot) {
          return Promise.resolve({ snapshot, tools: new Map() });
        },
      },
      createToolContext: ({ execution, signal }) => ({
        execution,
        abortSignal: signal,
        getSandbox() {
          throw new Error("No sandbox in Studio tests.");
        },
        getSkill() {
          throw new Error("No skills in Studio tests.");
        },
        getToken() {
          return Promise.reject(new Error("No auth in Studio tests."));
        },
        requireAuth() {
          throw new Error("No auth in Studio tests.");
        },
      }),
    });
    const studio = createStudioApplication({
      engine,
      store: createStore(),
      revisionProvider: { current: () => Promise.resolve("commit-1") },
      resolveCurrentAgent: () =>
        Promise.resolve({ snapshot: AGENT, tools: new Map() }),
    });
    try {
      const created = await studio.createThread({
        title: "Experiment",
        agent: AGENT,
        commitId: "commit-1",
      });
      const engineBeforeDraft = await engine.getThread(created.engineThreadId);
      await studio.saveDocument(created.id, {
        ...created.document,
        conversation: {
          messages: [
            {
              id: "user-1",
              role: "user",
              content: [
                { type: "text", text: "Inspect" },
                { type: "image", mimeType: "image/png", data: "aW1hZ2U=" },
              ],
            },
          ],
          state: {},
        },
      });
      expect(
        (await engine.getThread(created.engineThreadId))?.headCheckpointId
      ).toBe(engineBeforeDraft?.headCheckpointId);

      const first = await studio.run(created.id, { fromMessageId: "user-1" });
      await _untilCompleted(
        studio.events(created.id, { follow: true }),
        first.runId
      );
      const completed = await studio.loadThread(created.id);
      expect(completed?.document.conversation.messages).toMatchObject([
        { id: "user-1", role: "user" },
        {
          role: "assistant",
          content: [{ type: "text", text: "Studio answer" }],
        },
      ]);
      expect(await studio.listRunHistory(created.id)).toMatchObject([
        { run: { id: first.runId, status: "completed" }, checkpoint: {} },
      ]);

      const retry = await studio.run(created.id, { fromMessageId: "user-1" });
      await _untilCompleted(
        studio.events(created.id, { follow: true }),
        retry.runId
      );
      const retried = await studio.loadThread(created.id);
      expect(retried?.engineThreadId).not.toBe(created.engineThreadId);
      const retryEngineThread = await engine.getThread(retried!.engineThreadId);
      expect(retryEngineThread?.parent).toMatchObject({
        threadId: created.engineThreadId,
        relationship: "retry",
      });

      await studio.saveDocument(created.id, {
        ...retried!.document,
        conversation: {
          messages: [
            {
              id: "user-1",
              role: "user",
              content: [{ type: "text", text: "Inspect edited input" }],
            },
          ],
          state: { mode: "edited" },
        },
      });
      const edited = await studio.run(created.id, {
        fromMessageId: "user-1",
      });
      const editedRun = await engine.getRun(edited.runId);
      const editedView = await studio.loadThread(created.id);
      const editedEngineThread = await engine.getThread(
        editedView!.engineThreadId
      );
      expect(editedRun).toMatchObject({
        inputMessages: [
          {
            id: "user-1",
            content: [{ type: "text", text: "Inspect edited input" }],
          },
        ],
      });
      expect(editedRun?.retryOfRunId).toBeUndefined();
      expect(editedEngineThread?.parent?.relationship).toBe("fork");
      await _untilCompleted(
        studio.events(created.id, { follow: true }),
        edited.runId
      );

      await studio.saveEvaluationMetadata(created.id, {
        evaluations: [
          {
            id: "evaluation-1",
            leftRunId: first.runId,
            rightRunId: retry.runId,
            verdict: "tie",
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        rubrics: [],
      });
      expect(await studio.listEvaluationMetadata(created.id)).toMatchObject({
        evaluations: [{ id: "evaluation-1", threadId: created.id }],
      });
    } finally {
      await studio.close();
    }
  });

  test("steps and continues one durable Run while projecting semantic events", async () => {
    const engine = createAgentEngine({
      store: new InMemoryEngineStore(),
      runExecutor: _stepRunExecutor(),
      agentResolver: {
        resolve(snapshot) {
          return Promise.resolve({ snapshot, tools: new Map() });
        },
      },
      createToolContext: ({ execution, signal }) => ({
        execution,
        abortSignal: signal,
        getSandbox() {
          throw new Error("No sandbox in Studio tests.");
        },
        getSkill() {
          throw new Error("No skills in Studio tests.");
        },
        getToken() {
          return Promise.reject(new Error("No auth in Studio tests."));
        },
        requireAuth() {
          throw new Error("No auth in Studio tests.");
        },
      }),
    });
    const studio = createStudioApplication({
      engine,
      store: createStore(),
      revisionProvider: { current: () => Promise.resolve("commit-1") },
    });
    try {
      const created = await studio.createThread({
        agent: AGENT,
        commitId: "commit-1",
      });
      await studio.saveDocument(created.id, {
        ...created.document,
        conversation: {
          messages: [
            {
              id: "user-step",
              role: "user",
              content: [{ type: "text", text: "Inspect one step at a time" }],
            },
          ],
          state: {},
        },
      });

      const receipt = await studio.run(created.id, {
        fromMessageId: "user-step",
        mode: "step",
      });
      const firstPause = await _untilEvent(
        studio.events(created.id, { follow: true }),
        (event) =>
          event.event.type === "run.paused" &&
          event.event.run.id === receipt.runId
      );
      expect((await studio.loadThread(created.id))?.activeRunId).toBe(
        receipt.runId
      );
      expect(firstPause.event).toMatchObject({
        type: "run.paused",
        run: {
          id: receipt.runId,
          pause: { step: "model.completed" },
        },
      });

      const afterTool = await studio.stepRun(receipt.runId, {
        toolCallId: "call-lookup",
      });
      expect(afterTool.runId).toBe(receipt.runId);
      const secondPause = await _untilEvent(
        studio.events(created.id, {
          afterSequence: firstPause.sequence,
          follow: true,
        }),
        (event) =>
          event.event.type === "run.paused" &&
          event.event.run.pause?.step === "tool.completed"
      );

      const continued = await studio.continueRun(receipt.runId);
      expect(continued.runId).toBe(receipt.runId);
      const completed = await _untilEvent(
        studio.events(created.id, {
          afterSequence: secondPause.sequence,
          follow: true,
        }),
        (event) =>
          event.event.type === "run.completed" &&
          event.event.runId === receipt.runId
      );
      const projected: string[] = [];
      for await (const item of studio.events(created.id, {
        afterSequence: firstPause.sequence,
      })) {
        if (item.sequence > completed.sequence) break;
        projected.push(item.event.type);
      }
      const expectedEvents = [
        "tool.started",
        "tool.updated",
        "tool.completed",
        "message.completed",
        "conversation.updated",
        "run.completed",
      ];
      for (const expectedEvent of expectedEvents) {
        expect(projected).toContain(expectedEvent);
      }
      const finalThread = await studio.loadThread(created.id);
      expect(finalThread?.activeRunId).toBeUndefined();
      expect(finalThread).toMatchObject({
        document: {
          conversation: {
            messages: [
              { id: "user-step", role: "user" },
              {
                role: "assistant",
                toolCalls: [
                  {
                    id: "call-lookup",
                    output: {
                      content: [{ type: "text", text: "tool result" }],
                    },
                  },
                ],
              },
              {
                role: "assistant",
                content: [{ type: "text", text: "Finished." }],
              },
            ],
          },
        },
      });
    } finally {
      await studio.close();
    }
  });
});

test("recovers a Run whose Studio reference transaction was interrupted", async () => {
  const engine = createAgentEngine({
    store: new InMemoryEngineStore(),
    runExecutor: _textRunExecutor("Recovered answer"),
    agentResolver: {
      resolve(snapshot) {
        return Promise.resolve({ snapshot, tools: new Map() });
      },
    },
    createToolContext: ({ execution, signal }) => ({
      execution,
      abortSignal: signal,
      getSandbox() {
        throw new Error("No sandbox in Studio tests.");
      },
      getSkill() {
        throw new Error("No skills in Studio tests.");
      },
      getToken() {
        return Promise.reject(new Error("No auth in Studio tests."));
      },
      requireAuth() {
        throw new Error("No auth in Studio tests.");
      },
    }),
  });
  const store = new FailingRunReferenceStudioStore();
  const options = {
    engine,
    store,
    revisionProvider: { current: () => Promise.resolve("commit-1") },
    resolveCurrentAgent: () =>
      Promise.resolve({ snapshot: AGENT, tools: new Map() }),
  };
  const first = createStudioApplication(options);
  const created = await first.createThread({
    title: "Recover experiment",
    agent: AGENT,
  });
  await first.saveDocument(created.id, {
    ...created.document,
    conversation: {
      messages: [
        {
          id: "user-recover",
          role: "user",
          content: [{ type: "text", text: "Recover this Run" }],
        },
      ],
      state: {},
    },
  });
  store.failNextRunReference = true;

  expect(
    first.run(created.id, { fromMessageId: "user-recover" })
  ).rejects.toThrow("Simulated Studio reference failure.");

  const recovered = createStudioApplication(options);
  try {
    // Public reads wait for startup reconciliation, so the recovered
    // association is visible without polling the application Store.
    expect(await recovered.listRunHistory(created.id)).toHaveLength(1);
    await _waitUntil(
      async () =>
        (await recovered.listRunHistory(created.id))[0]?.checkpoint !==
        undefined
    );
    expect(await recovered.listRunHistory(created.id)).toMatchObject([
      {
        run: { status: "completed" },
        checkpoint: {
          document: {
            conversation: {
              messages: [
                { id: "user-recover", role: "user" },
                { role: "assistant" },
              ],
            },
          },
        },
      },
    ]);
  } finally {
    await recovered.close();
  }
});

async function _untilCompleted(
  events: AsyncIterable<{
    readonly event: { readonly type: string; readonly runId?: string };
  }>,
  runId: string
): Promise<void> {
  for await (const event of events) {
    if (event.event.type === "run.completed" && event.event.runId === runId)
      return;
  }
  throw new Error("Studio event stream ended before Run completion.");
}

async function _untilEvent(
  events: AsyncIterable<
    import("./domain").StudioThreadEvent
  >,
  predicate: (event: import("./domain").StudioThreadEvent) => boolean
): Promise<import("./domain").StudioThreadEvent> {
  for await (const event of events) {
    if (predicate(event)) return event;
  }
  throw new Error("Studio event stream ended before the expected event.");
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

function _stepRunExecutor(): RunExecutor {
  return {
    async executeStep(input, sink) {
      if (input.step.type === "tools") {
        const requested = input.messages.findLast(
          (message) => message.role === "assistant"
        );
        if (requested?.role !== "assistant") {
          throw new Error("Tool Step requires an Assistant Message.");
        }
        const completed = {
          ...requested,
          toolCalls: requested.toolCalls?.map((call) =>
            input.step.type === "tools" &&
            input.step.toolCallIds.includes(call.id)
              ? {
                  ...call,
                  output: {
                    content: [
                      { type: "text" as const, text: "tool result" },
                    ],
                    isError: false,
                  },
                }
              : call
          ),
        };
        for (const toolCallId of input.step.toolCallIds) {
          await sink.accept({
            type: "tool.started",
            messageId: requested.id,
            toolCallId,
            toolName: "lookup",
          });
          await sink.accept({
            type: "tool.updated",
            messageId: requested.id,
            toolCallId,
            message: completed,
          });
          await sink.accept({
            type: "tool.completed",
            messageId: requested.id,
            toolCallId,
            message: completed,
          });
        }
        return;
      }
      const previous = input.messages.at(-1);
      const message =
        previous?.role === "assistant"
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
                  id: "call-lookup",
                  input: { name: "lookup", arguments: {} },
                },
              ],
            };
      await sink.accept({ type: "assistant.completed", message });
    },
  };
}

async function _waitUntil(predicate: () => Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Condition was not met before the test deadline.");
}

class FailingRunReferenceStudioStore implements StudioStore {
  private readonly _inner = new InMemoryStudioStore();
  failNextRunReference = false;

  transaction<T>(fn: (tx: StudioStoreTransaction) => T): T {
    return this._inner.transaction((tx) =>
      fn(
        new Proxy(tx, {
          get: (target, property) => {
            if (property === "replaceRunReferences") {
              return (
                ...args: Parameters<typeof target.replaceRunReferences>
              ) => {
                if (this.failNextRunReference) {
                  this.failNextRunReference = false;
                  throw new Error("Simulated Studio reference failure.");
                }
                return target.replaceRunReferences(...args);
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
