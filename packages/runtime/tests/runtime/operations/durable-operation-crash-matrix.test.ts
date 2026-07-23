import {
  type Api,
  type AssistantMessage,
  type Context,
  createAssistantMessageEventStream,
  createModels,
  createProvider,
  type Model
} from "@earendil-works/pi-ai";
import {
  DurableOperationFingerprintMismatchError,
  DurableOperationOutcomeUnknownError,
  InMemorySessionStore,
  MAX_DURABLE_OPERATION_REPLAY_BYTES,
  recoverRuntimeSession,
  RUNTIME_SESSION_SCHEMA_VERSION,
  type RuntimeRunConfigurationSnapshot,
  type SessionStore,
  SessionStoreConflictError,
  type StoredRuntimeSession,
  UnsupportedRuntimeSessionSchemaError
} from "@llm-space/runtime/harness";
import { AgentRuntime } from "@llm-space/runtime/node";
import { describe, expect, test } from "bun:test";

import {
  createDurableOperationReplayEnvelope,
  DurableOperationCoordinator,
  fingerprintDurableOperationValue
} from "../../../src/runtime/operations/durable-operation-coordinator";

import type { PreparedAgentTool } from "../../../src/runtime/agent/prepared-agent-tool";

const CONFIGURATION: RuntimeRunConfigurationSnapshot = {
  id: "configuration-durable",
  agentSnapshotFingerprint: "agent-durable",
  contextFingerprint: "context-durable",
  executionMode: "react",
  model: { provider: "fake", id: "fake-model" },
  toolConfigurationFingerprint: "tools-durable"
};

describe("Durable operation crash matrix", () => {
  test("replays a durable provider completion without dispatching it again", async () => {
    const store = await _startedStore();
    const first = new DurableOperationCoordinator(_options(store));
    const begun = await first.beginProvider({
      provider: "fake",
      request: { messages: ["hello"] }
    });
    expect(begun).toMatchObject({
      type: "dispatch",
      operation: { state: "preCall", kind: "provider" }
    });
    if (begun?.type !== "dispatch") {
      throw new Error("Expected provider dispatch");
    }
    await first.settleProvider({
      operation: begun.operation,
      state: "completed",
      value: { type: "providerMessage", message: _assistant("done") }
    });

    const persistedCompletion = await _required(store.load("session-durable"));
    const recoveredStore = new InMemorySessionStore([persistedCompletion]);
    const recovered = new DurableOperationCoordinator(_options(recoveredStore));
    const replay = await recovered.beginProvider({
      provider: "fake",
      request: { messages: ["hello"] }
    });
    expect(replay).toMatchObject({
      type: "replay",
      operation: {
        id: begun.operation.id,
        state: "completed",
        replay: { byteLength: expect.any(Number) }
      },
      value: { type: "providerMessage" }
    });
    expect(await _rejection(recovered.beginProvider({
      provider: "fake",
      request: { messages: ["changed"] }
    }))).toBeInstanceOf(DurableOperationFingerprintMismatchError);

    const current = await _required(recoveredStore.load("session-durable"));
    const terminal = await recoveredStore.commit({
      sessionId: "session-durable",
      expectedVersion: current.version,
      mutations: [{ type: "transitionRun", runId: "run-durable", to: "completed" }]
    });
    expect(terminal.snapshot.operationLedger?.steps[0]).toMatchObject({
      state: "checkpointed",
      operations: [{ state: "completed" }]
    });
    expect(terminal.snapshot.operationLedger?.steps[0]?.operations[0]?.replay)
      .toBeUndefined();
    expect(terminal.snapshot.operationLedger?.steps[0]?.operations[0])
      .toMatchObject({
        replayByteLength: expect.any(Number),
        resultFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
        startedAt: expect.any(Number),
        settledAt: expect.any(Number)
      });
  });

  test("elevates a durable pre-call with no terminal to outcome unknown", async () => {
    const store = await _startedStore();
    const coordinator = new DurableOperationCoordinator(_options(store));
    const begun = await coordinator.beginProvider({
      provider: "fake",
      request: { messages: ["ambiguous"] }
    });
    expect(begun?.type).toBe("dispatch");

    const recovered = await recoverRuntimeSession(store, "session-durable");
    expect(recovered).toMatchObject({
      status: "outcomeUnknown",
      run: { id: "run-durable", state: "outcomeUnknown" },
      session: { snapshot: { activeRunId: null } }
    });
    if (recovered.status !== "outcomeUnknown") {
      throw new Error("Expected outcome-unknown recovery");
    }
    expect(recovered.session.snapshot.operationLedger?.steps[0]).toMatchObject({
      state: "checkpointed",
      operations: [{ state: "outcomeUnknown" }]
    });
    expect(recovered.session.journal.slice(-3).map(entry => entry.type)).toEqual([
      "operationSettled",
      "operationStepCheckpointed",
      "runStateChanged"
    ]);
  });

  test("persists a mixed parallel tool batch without retrying the unknown child", async () => {
    const store = await _startedStore();
    const coordinator = new DurableOperationCoordinator(_options(store));
    const provider = await coordinator.beginProvider({
      provider: "fake",
      request: { messages: ["tools"] }
    });
    if (provider?.type !== "dispatch") {
      throw new Error("Expected provider dispatch");
    }
    await coordinator.settleProvider({
      operation: provider.operation,
      state: "completed",
      value: { type: "providerMessage", message: _assistant("tools") }
    });

    let completedExecutions = 0;
    const completed = coordinator.wrapTool(_tool("complete", async () => {
      completedExecutions += 1;
      return {
        type: "completed",
        result: { content: [{ type: "text", text: "ok" }], details: {} }
      };
    }));
    const unknown = coordinator.wrapTool(_tool("unknown", async () => {
      throw new Error("local abort after dispatch");
    }));
    await coordinator.prepareToolCall({
      name: "complete",
      toolCallId: "call-complete",
      arguments: {}
    });
    await coordinator.prepareToolCall({
      name: "unknown",
      toolCallId: "call-unknown",
      arguments: {}
    });
    if (completed.kind !== "executable" || unknown.kind !== "executable") {
      throw new Error("Expected executable tools");
    }
    await completed.execute(
      "call-complete",
      {},
      new AbortController().signal,
      () => {}
    );
    const aborted = new AbortController();
    aborted.abort();
    expect(await _rejection(unknown.execute(
      "call-unknown",
      {},
      aborted.signal,
      () => {}
    ))).toBeInstanceOf(DurableOperationOutcomeUnknownError);

    const current = await _required(store.load("session-durable"));
    const terminal = await store.commit({
      sessionId: "session-durable",
      expectedVersion: current.version,
      mutations: [
        ...coordinator.toolBatchMutations({ checkpoint: false }),
        { type: "transitionRun", runId: "run-durable", to: "outcomeUnknown" }
      ]
    });
    coordinator.markToolBatchCommitted({ checkpoint: false });
    expect(completedExecutions).toBe(1);
    expect(terminal.snapshot.operationLedger?.steps[0]?.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          toolCallId: "call-complete",
          state: "completed"
        }),
        expect.objectContaining({
          toolCallId: "call-unknown",
          state: "outcomeUnknown"
        })
      ])
    );
  });

  test("records a known thrown tool error as failed for Pi recovery", async () => {
    const store = await _startedStore();
    const coordinator = new DurableOperationCoordinator(_options(store));
    const provider = await coordinator.beginProvider({
      provider: "fake",
      request: { messages: ["known-tool-error"] }
    });
    if (provider?.type !== "dispatch") {
      throw new Error("Expected provider dispatch");
    }
    await coordinator.settleProvider({
      operation: provider.operation,
      state: "completed",
      value: { type: "providerMessage", message: _assistant("tool") }
    });
    const tool = coordinator.wrapTool(_tool("known-error", async () => {
      throw new Error("recoverable tool error");
    }));
    await coordinator.prepareToolCall({
      name: "known-error",
      toolCallId: "call-known-error",
      arguments: {}
    });
    if (tool.kind !== "executable") {
      throw new Error("Expected executable tool");
    }
    expect(await _rejection(tool.execute(
      "call-known-error",
      {},
      new AbortController().signal,
      () => {}
    ))).toMatchObject({ message: "recoverable tool error" });
    const current = await _required(store.load("session-durable"));
    const committed = await store.commit({
      sessionId: "session-durable",
      expectedVersion: current.version,
      mutations: coordinator.toolBatchMutations({ checkpoint: true })
    });
    coordinator.markToolBatchCommitted({ checkpoint: true });
    expect(committed.snapshot.operationLedger?.steps[0]?.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          toolCallId: "call-known-error",
          state: "failed",
          resultFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/)
        })
      ])
    );
  });

  test("replays a returned error result as a known failed tool outcome", async () => {
    const store = await _startedStore();
    const coordinator = new DurableOperationCoordinator(_options(store));
    const provider = await coordinator.beginProvider({
      provider: "fake",
      request: { messages: ["returned-tool-error"] }
    });
    if (provider?.type !== "dispatch") {
      throw new Error("Expected provider dispatch");
    }
    await coordinator.settleProvider({
      operation: provider.operation,
      state: "completed",
      value: { type: "providerMessage", message: _assistant("tool") }
    });
    let dispatches = 0;
    const definition = _tool("returned-error", async () => {
      dispatches += 1;
      return {
        type: "completed",
        result: {
          content: [{ type: "text", text: "known error" }],
          details: {},
          isError: true
        }
      };
    });
    const tool = coordinator.wrapTool(definition);
    await coordinator.prepareToolCall({
      name: "returned-error",
      toolCallId: "call-returned-error",
      arguments: {}
    });
    if (tool.kind !== "executable") {
      throw new Error("Expected executable tool");
    }
    expect(await tool.execute(
      "call-returned-error",
      {},
      new AbortController().signal,
      () => {}
    )).toMatchObject({ result: { isError: true } });
    const current = await _required(store.load("session-durable"));
    await store.commit({
      sessionId: "session-durable",
      expectedVersion: current.version,
      mutations: coordinator.toolBatchMutations({ checkpoint: false })
    });
    coordinator.markToolBatchCommitted({ checkpoint: false });

    const recovered = new DurableOperationCoordinator(_options(store));
    const replayed = recovered.wrapTool(definition);
    if (replayed.kind !== "executable") {
      throw new Error("Expected replayable tool");
    }
    expect(await replayed.execute(
      "call-returned-error",
      {},
      new AbortController().signal,
      () => {}
    )).toMatchObject({ result: { isError: true } });
    expect(dispatches).toBe(1);
    expect((await _required(store.load("session-durable")))
      .snapshot.operationLedger?.steps[0]?.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          toolCallId: "call-returned-error",
          state: "failed"
        })
      ])
    );
  });

  test("commits provider and tool boundaries through the real Pi Agent loop", async () => {
    const store = await _startedStore();
    let providerDispatches = 0;
    let toolDispatches = 0;
    const model: Model<"fake"> = {
      id: "fake-model",
      name: "Fake",
      api: "fake",
      provider: "fake",
      baseUrl: "http://localhost.invalid",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 8_192,
      maxTokens: 1_024
    };
    const provider = createProvider({
      id: "fake",
      auth: {
        apiKey: {
          name: "Fake",
          resolve: async () => ({ auth: {} })
        }
      },
      models: [model],
      api: {
        stream: (_model: Model<Api>, context: Context) => {
          providerDispatches += 1;
          return _reactStream(context);
        },
        streamSimple: (_model: Model<Api>, context: Context) => {
          providerDispatches += 1;
          return _reactStream(context);
        }
      }
    });
    const models = createModels();
    models.setProvider(provider);
    const runtime = new AgentRuntime({
      models,
      project: {
        root: "/durable-agent",
        definition: { model: { provider: "fake", id: "fake-model" } },
        instructions: "Test durable execution.",
        tools: [],
        connections: [],
        resources: {},
        diagnostics: [],
        fingerprint: "durable-agent-snapshot"
      }
    });
    const session = await runtime.createSession({
      context: _context(),
      sessionStore: store,
      capabilityPolicy: {
        connectionContributions: [],
        modelOptions: {},
        models: [{ provider: "fake", id: "fake-model" }],
        reasoning: ["off", "minimal", "low", "medium", "high", "xhigh"],
        toolContributions: ["host-tool:echo"]
      },
      executionMode: "react",
      extraTools: [{
        kind: "executable",
        provenance: { contributionId: "host-tool:echo" },
        definition: {
          name: "echo",
          label: "Echo",
          description: "Echo once.",
          parameters: {
            type: "object",
            properties: {},
            additionalProperties: false
          }
        },
        async execute() {
          toolDispatches += 1;
          return {
            type: "completed",
            result: {
              content: [{ type: "text", text: "echoed" }],
              details: {}
            }
          };
        }
      }]
    });
    await session.prompt("hello");

    expect(providerDispatches).toBe(2);
    expect(toolDispatches).toBe(1);
    const persisted = await _required(store.load("session-durable"));
    expect(persisted.snapshot.operationLedger?.steps).toHaveLength(2);
    expect(persisted.snapshot.operationLedger?.steps[0]).toMatchObject({
      sequence: 1,
      state: "checkpointed",
      operations: [
        { kind: "provider", state: "completed" },
        { kind: "tool", toolCallId: "call-echo", state: "completed" }
      ]
    });
    expect(persisted.snapshot.operationLedger?.steps[0]?.operations.every(
      operation => !Object.hasOwn(operation, "replay")
    )).toBe(true);
    expect(persisted.snapshot.operationLedger?.steps[1]).toMatchObject({
      sequence: 2,
      state: "active",
      operations: [{ kind: "provider", state: "completed" }]
    });
  });

  test("admits exactly one Host-authenticated CAS resume for a parked operation", async () => {
    const store = await _startedStore();
    const current = await _required(store.load("session-durable"));
    const requestFingerprint = await fingerprintDurableOperationValue({
      name: "approval-boundary",
      arguments: {}
    });
    const parked = await store.commit({
      sessionId: "session-durable",
      expectedVersion: current.version,
      mutations: [{
        type: "startOperation",
        runId: "run-durable",
        stepId: "run-durable:step:1",
        stepSequence: 1,
        transcriptMessageCount: 0,
        operationId: "run-durable:step:1:tool:call-parked",
        kind: "tool",
        toolCallId: "call-parked",
        requestFingerprint,
        park: {
          parkId: "park-one",
          reason: "Host policy decision",
          resumeSchemaFingerprint: "a".repeat(64)
        }
      }]
    });
    const claim = {
      sessionId: "session-durable",
      runId: "run-durable",
      operationId: "run-durable:step:1:tool:call-parked",
      parkId: "park-one",
      resumeSchemaFingerprint: "a".repeat(64),
      expectedVersion: parked.version
    };
    const first = new DurableOperationCoordinator(_options(store));
    const second = new DurableOperationCoordinator(_options(store));
    expect(await _rejection(first.resumeParkedOperation(claim, {
      name: "approval-boundary",
      arguments: { changed: true }
    }))).toBeInstanceOf(Error);
    expect((await _required(store.load("session-durable")))).toMatchObject({
      version: parked.version,
      snapshot: {
        operationLedger: {
          steps: [{ operations: [{ state: "parked" }] }]
        }
      }
    });
    const contenders = await Promise.allSettled([
      first.resumeParkedOperation(claim, {
        name: "approval-boundary",
        arguments: {}
      }),
      second.resumeParkedOperation(claim, {
        name: "approval-boundary",
        arguments: {}
      })
    ]);
    expect(contenders.filter(item => item.status === "fulfilled")).toHaveLength(1);
    expect(contenders.find(item => item.status === "rejected")).toMatchObject({
      status: "rejected",
      reason: expect.any(SessionStoreConflictError)
    });
    const resumed = (await _required(store.load("session-durable")))
      .snapshot.operationLedger?.steps[0]?.operations[0];
    expect(resumed).toMatchObject({ state: "preCall" });
    expect(resumed && Object.hasOwn(resumed, "park")).toBe(false);
    const winner = contenders[0]?.status === "fulfilled" ? first : second;
    let dispatches = 0;
    const tool = winner.wrapTool(_tool("approval-boundary", async () => {
      dispatches += 1;
      return {
        type: "completed",
        result: { content: [{ type: "text", text: "approved" }], details: {} }
      };
    }));
    if (tool.kind !== "executable") {
      throw new Error("Expected resumed executable tool");
    }
    await tool.execute(
      "call-parked",
      {},
      new AbortController().signal,
      () => {}
    );
    expect(dispatches).toBe(1);
  });

  test("turns completion persistence failure into an explicit unknown outcome", async () => {
    const memory = await _startedStore();
    let rejectCompletion = true;
    const store = {
      load: memory.load.bind(memory),
      commit: async (...args: Parameters<typeof memory.commit>) => {
        const [input] = args;
        if (
          rejectCompletion
          && input.mutations.some(mutation =>
            mutation.type === "settleOperation"
            && mutation.state === "completed")
        ) {
          rejectCompletion = false;
          throw new Error("completion disk failure");
        }
        return memory.commit(...args);
      }
    };
    const coordinator = new DurableOperationCoordinator(_options(store));
    const begun = await coordinator.beginProvider({
      provider: "fake",
      request: { messages: ["commit-failure"] }
    });
    if (begun?.type !== "dispatch") {
      throw new Error("Expected provider dispatch");
    }
    expect(await _rejection(coordinator.settleProvider({
      operation: begun.operation,
      state: "completed",
      value: { type: "providerMessage", message: _assistant("lost") }
    }))).toBeInstanceOf(DurableOperationOutcomeUnknownError);
    expect((await _required(memory.load("session-durable")))
      .snapshot.operationLedger?.steps[0]?.operations[0]).toMatchObject({
      state: "outcomeUnknown"
    });
  });

  test("keeps a proven pre-dispatch cancellation distinct from ambiguity", async () => {
    const store = await _startedStore();
    const coordinator = new DurableOperationCoordinator(_options(store));
    const begun = await coordinator.beginProvider({
      provider: "fake",
      request: { messages: ["cancel-before-dispatch"] }
    });
    if (begun?.type !== "dispatch") {
      throw new Error("Expected provider dispatch boundary");
    }
    await coordinator.markCancelled(begun.operation);
    expect(await recoverRuntimeSession(store, "session-durable")).toMatchObject({
      status: "cancelled",
      run: { state: "cancelled" }
    });
  });

  test("rejects replay material that is oversized or not serializable", async () => {
    expect(await _rejection(createDurableOperationReplayEnvelope(
      "x".repeat(MAX_DURABLE_OPERATION_REPLAY_BYTES + 1)
    ))).toBeInstanceOf(Error);
    const circular: { self?: unknown; } = {};
    circular.self = circular;
    expect(await _rejection(createDurableOperationReplayEnvelope(circular)))
      .toBeInstanceOf(TypeError);
  });

  test("rejects an old Runtime Session schema without mutating it", () => {
    const old = {
      version: 1,
      snapshot: {
        schemaVersion: 1,
        id: "session-old",
        activeRunId: null,
        runs: []
      },
      configurations: [],
      journal: []
    };
    const before = structuredClone(old);
    expect(() => new InMemorySessionStore([
      old as unknown as StoredRuntimeSession
    ])).toThrow(UnsupportedRuntimeSessionSchemaError);
    expect(old).toEqual(before);
    expect(RUNTIME_SESSION_SCHEMA_VERSION).toBe(2);
  });
});

async function _startedStore(): Promise<InMemorySessionStore> {
  const store = new InMemorySessionStore();
  await store.commit({
    sessionId: "session-durable",
    expectedVersion: null,
    mutations: [{
      type: "startRun",
      runId: "run-durable",
      configuration: CONFIGURATION
    }]
  });
  return store;
}

function _options(store: SessionStore) {
  return {
    sessionId: "session-durable",
    runId: "run-durable",
    sessionStore: store
  };
}

function _assistant(text: string) {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "fake",
    provider: "fake",
    model: "fake-model",
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0
      }
    },
    stopReason: "stop",
    timestamp: 1
  };
}

function _context() {
  const principal = {
    issuer: "test",
    principalId: "durable-test",
    principalType: "runtime" as const
  };
  return {
    id: "session-durable",
    auth: { initiator: principal, current: principal },
    channel: { kind: "test" },
    turn: { id: "run-durable", sequence: 1 }
  };
}

function _reactStream(context: Context) {
  const stream = createAssistantMessageEventStream();
  const hasToolResult = context.messages.at(-1)?.role === "toolResult";
  const message: AssistantMessage = {
    ..._assistant(hasToolResult ? "done" : ""),
    content: hasToolResult
      ? [{ type: "text", text: "done" }]
      : [{
        type: "toolCall",
        id: "call-echo",
        name: "echo",
        arguments: {}
      }],
    stopReason: hasToolResult ? "stop" : "toolUse"
  };
  queueMicrotask(() => {
    stream.push({ type: "start", partial: message });
    stream.push(hasToolResult
      ? { type: "done", reason: "stop", message }
      : { type: "done", reason: "toolUse", message });
  });
  return stream;
}

function _tool(
  name: string,
  execute: Extract<PreparedAgentTool, { kind: "executable"; }>["execute"]
): PreparedAgentTool {
  return {
    kind: "executable",
    definition: {
      name,
      label: name,
      description: name,
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false
      }
    },
    execute
  };
}

async function _required<T>(promise: Promise<T | null>): Promise<T> {
  const value = await promise;
  if (!value) { throw new Error("Expected value"); }
  return value;
}

async function _rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("Expected rejection");
}
