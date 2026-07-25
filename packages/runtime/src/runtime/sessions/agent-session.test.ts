import {
  type Api,
  type AssistantMessage,
  type Context,
  createAssistantMessageEventStream,
  type Model,
  type Models,
  type ToolResultMessage
} from "@earendil-works/pi-ai";
import { describe, expect, test } from "bun:test";

import type {
  AgentMessage,
  StreamFn
} from "@earendil-works/pi-agent-core";

import { always, deny, never, once } from "../../public/tools/approval";
import { AgentRuntime } from "../agent/agent-runtime";
import { resumeDurableOperation } from "../harness/durable-operation-resume";
import { InMemorySessionStore } from "../harness/in-memory-session-store";
import { decideRuntimeToolApproval } from "../harness/runtime-tool-approval-decision";
import { RuntimeToolApprovalStaleError } from "../harness/runtime-tool-approval-stale-error";

import type { Approval } from "../../public/definitions/approval";
import type { AgentProjectSnapshot } from "../agent/agent-project-snapshot";

describe("AgentSession Pi Agent ownership", () => {
  test("reloads a settled manual tool call and continues without a user turn", async () => {
    const runtime = _runtime();
    let persisted: AgentMessage[] = [];
    const persistence = {
      replaceMessages(messages: AgentMessage[]) {
        persisted = messages;
      }
    };
    const firstSession = await runtime.createSession({
      capabilityPolicy: _policy(),
      context: _context("manual-session"),
      executionMode: "manual",
      persistence,
      streamFn: _manualStream
    });

    await firstSession.prompt("hello");

    expect(persisted.map(message => message.role)).toEqual([
      "user",
      "assistant"
    ]);

    const reloadedSession = await runtime.createSession({
      capabilityPolicy: _policy(),
      context: _context("manual-session"),
      executionMode: "manual",
      initialMessages: persisted,
      persistence,
      streamFn: _manualStream
    });
    await reloadedSession.resolveToolResults([_toolResult()]);
    await reloadedSession.continue();

    expect(reloadedSession.messages.map(message => message.role)).toEqual([
      "user",
      "assistant",
      "toolResult",
      "assistant"
    ]);
    expect(
      reloadedSession.messages.filter(message => message.role === "user")
    ).toHaveLength(1);
    expect(reloadedSession.messages[2]).toMatchObject({
      role: "toolResult",
      toolCallId: "call-one",
      toolName: "echo"
    });
  });

  test("persists the public transcript before publishing agent_end", async () => {
    const order: string[] = [];
    const session = await _runtime().createSession({
      capabilityPolicy: _policy(),
      context: _context("persistence-session"),
      persistence: {
        replaceMessages(messages) {
          order.push(`persist:${messages.map(message => message.role).join(",")}`);
        }
      },
      streamFn: _stoppedStream
    });
    session.subscribe(event => {
      if (event.type === "agent_end") {
        order.push("agent_end");
      }
    });

    await session.prompt("hello");

    expect(order.slice(-2)).toEqual([
      "persist:user,assistant",
      "agent_end"
    ]);
  });

  test("parks an automatically executable tool before dispatch when source approval is required", async () => {
    let executions = 0;
    const context = _context("approval-session");
    const store = new InMemorySessionStore();
    await store.commit({
      sessionId: context.id,
      expectedVersion: null,
      mutations: [{
        type: "startRun",
        runId: context.turn.id,
        messages: [],
        configuration: {
          id: "configuration-approval",
          agentSnapshotFingerprint: "snapshot-approval",
          contextFingerprint: "context-approval",
          executionMode: "react",
          model: { provider: "fake", id: "fake-model" },
          toolConfigurationFingerprint: "tools-approval"
        }
      }]
    });
    const runtime = new AgentRuntime({
      models: _models(),
      project: _project({
        approval: always(),
        onExecute: () => { executions += 1; }
      })
    });
    const events: string[] = [];
    const session = await runtime.createSession({
      capabilityPolicy: _policy(),
      context,
      executionMode: "react",
      sessionStore: store,
      streamFn: _manualStream
    });
    session.subscribe(event => { events.push(event.type); });

    await session.prompt("hello");

    const persisted = await store.load(context.id);
    expect(executions).toBe(0);
    expect(events).toContain("tool_calls_deferred");
    expect(persisted?.snapshot.approvalLedger?.requests).toMatchObject([{
      state: "pending",
      scope: "call",
      toolCallId: "call-one",
      toolName: "echo"
    }]);
    expect(
      persisted?.snapshot.operationLedger?.steps[0]?.operations.find(
        operation => operation.toolCallId === "call-one"
      )
    ).toMatchObject({ state: "parked", toolCallId: "call-one" });
  });

  test("lets Host policy deny a tool that source policy would run", async () => {
    let executions = 0;
    const context = _context("host-denied-approval-session");
    const store = await _startedStore(context);
    const session = await new AgentRuntime({
      models: _models(),
      project: _project({
        approval: never(),
        onExecute: () => { executions += 1; }
      })
    }).createSession({
      approvalPolicy: {
        id: "test-host-policy-v1",
        evaluate: () => deny("Transfers are disabled by this Host")
      },
      capabilityPolicy: _policy(),
      context,
      executionMode: "react",
      sessionStore: store,
      streamFn: _manualStream
    });

    await session.prompt("hello");

    const persisted = await store.load(context.id);
    expect(executions).toBe(0);
    expect(persisted?.snapshot.approvalLedger?.requests).toMatchObject([{
      state: "denied",
      reason: "Transfers are disabled by this Host",
      toolCallId: "call-one"
    }]);
    expect(
      persisted?.snapshot.operationLedger?.steps[0]?.operations.find(
        operation => operation.toolCallId === "call-one"
      )
    ).toMatchObject({ state: "cancelled" });
    expect(session.messages.some(message =>
      message.role === "toolResult"
      && message.toolCallId === "call-one"
      && message.isError)).toBe(true);
  });

  test("reuses a matching once grant later in the same Session", async () => {
    let executions = 0;
    let policyCalls = 0;
    const context = _context("once-grant-session");
    const store = await _startedStore(context);
    const runtime = new AgentRuntime({
      models: _models(),
      project: _project({
        approval: () => {
          policyCalls += 1;
          return policyCalls <= 2
            ? "once"
            : deny("Conditional policy changed for this call");
        },
        onExecute: () => { executions += 1; }
      })
    });
    const first = await runtime.createSession({
      capabilityPolicy: _policy(),
      context,
      executionMode: "react",
      sessionStore: store,
      streamFn: _manualStream
    });
    await first.prompt("first");
    const pending = await store.load(context.id);
    const request = pending?.snapshot.approvalLedger?.requests[0];
    const parked = pending?.snapshot.operationLedger?.steps[0]?.operations.find(
      operation => operation.toolCallId === "call-one"
    );
    if (!pending || !request || !parked?.park) {
      throw new Error("Expected a parked once approval");
    }
    const approved = await decideRuntimeToolApproval(store, {
      actor: context.auth,
      decision: "approved",
      expectedVersion: pending.version,
      requestId: request.id,
      runId: context.turn.id,
      sessionId: context.id
    });
    const resumed = await resumeDurableOperation(store, {
      expectedVersion: approved.version,
      operationId: parked.id,
      parkId: parked.park.parkId,
      requestFingerprint: parked.requestFingerprint,
      resumeSchemaFingerprint: parked.park.resumeSchemaFingerprint,
      runId: context.turn.id,
      sessionId: context.id
    });
    await store.commit({
      sessionId: context.id,
      expectedVersion: resumed.version,
      mutations: [
        {
          type: "settleOperation",
          runId: context.turn.id,
          operationId: parked.id,
          requestFingerprint: parked.requestFingerprint,
          state: "cancelled"
        },
        {
          type: "checkpointOperationStep",
          runId: context.turn.id,
          stepId: parked.stepId
        }
      ]
    });

    const second = await runtime.createSession({
      capabilityPolicy: _policy(),
      context,
      executionMode: "react",
      initialMessages: first.messages,
      sessionStore: store,
      streamFn: _manualStream
    });
    await second.prompt("second");

    const persisted = await store.load(context.id);
    expect(executions).toBe(1);
    expect(persisted?.snapshot.approvalLedger?.requests).toHaveLength(1);
    const activeStep = persisted?.snapshot.operationLedger?.steps.find(
      step => step.state === "active"
    );
    if (!persisted || !activeStep) {
      throw new Error("Expected the completed provider-only Step");
    }
    await store.commit({
      sessionId: context.id,
      expectedVersion: persisted.version,
      mutations: [{
        type: "checkpointOperationStep",
        runId: context.turn.id,
        stepId: activeStep.id
      }]
    });

    const third = await runtime.createSession({
      capabilityPolicy: _policy(),
      context,
      executionMode: "react",
      initialMessages: second.messages,
      sessionStore: store,
      streamFn: _manualStream
    });
    await third.prompt("third");
    const denied = await store.load(context.id);
    expect(executions).toBe(1);
    expect(denied?.snapshot.approvalLedger?.requests.at(-1)).toMatchObject({
      state: "denied",
      reason: "Conditional policy changed for this call"
    });
  });

  test("parks a parallel batch before any sibling tool dispatches", async () => {
    let executions = 0;
    const context = _context("parallel-approval-session");
    const store = await _startedStore(context);
    const session = await new AgentRuntime({
      models: _models(),
      project: _project({
        approval: never(),
        onExecute: () => { executions += 1; }
      })
    }).createSession({
      approvalPolicy: {
        id: "parallel-host-policy-v1",
        evaluate: approvalContext => (approvalContext.callId === "call-one"
          ? always()
          : never())
      },
      capabilityPolicy: _policy(),
      context,
      executionMode: "react",
      sessionStore: store,
      streamFn: _parallelToolStream
    });

    await session.prompt("hello");

    const persisted = await store.load(context.id);
    expect(executions).toBe(0);
    expect(persisted?.snapshot.approvalLedger?.requests).toMatchObject([{
      state: "pending",
      toolCallId: "call-one"
    }]);
    expect(
      persisted?.snapshot.operationLedger?.steps[0]?.operations.some(
        operation => operation.toolCallId === "call-two"
      )
    ).toBe(false);
  });

  test("does not pre-claim an earlier sibling before a later approval parks the batch", async () => {
    const context = _context("reverse-parallel-approval-session");
    const store = await _startedStore(context);
    const session = await new AgentRuntime({
      models: _models(),
      project: _project({ approval: never() })
    }).createSession({
      approvalPolicy: {
        id: "reverse-parallel-host-policy-v1",
        evaluate: approvalContext => (approvalContext.callId === "call-two"
          ? always()
          : never())
      },
      capabilityPolicy: _policy(),
      context,
      executionMode: "react",
      sessionStore: store,
      streamFn: _parallelToolStream
    });

    await session.prompt("hello");

    const persisted = await store.load(context.id);
    const toolOperations = persisted?.snapshot.operationLedger?.steps[0]
      ?.operations.filter(operation => operation.kind === "tool") ?? [];
    expect(toolOperations).toMatchObject([{
      state: "parked",
      toolCallId: "call-two"
    }]);
  });

  test("finishes every parallel policy preflight before dispatching an allowed sibling", async () => {
    const order: string[] = [];
    const context = _context("parallel-denial-session");
    const store = await _startedStore(context);
    const session = await new AgentRuntime({
      models: _models(),
      project: _project({
        approval: never(),
        onExecute: () => { order.push("execute"); }
      })
    }).createSession({
      approvalPolicy: {
        id: "parallel-denial-policy-v1",
        evaluate: approvalContext => {
          order.push(`policy:${approvalContext.callId}`);
          return approvalContext.callId === "call-two"
            ? deny("Second call is blocked")
            : never();
        }
      },
      capabilityPolicy: _policy(),
      context,
      executionMode: "autoOnce",
      sessionStore: store,
      streamFn: _parallelToolStream
    });

    await session.prompt("hello");

    expect(order).toEqual(["policy:call-one", "policy:call-two", "execute"]);
    const persisted = await store.load(context.id);
    expect(persisted?.snapshot.approvalLedger?.requests).toMatchObject([{
      state: "denied",
      toolCallId: "call-two"
    }]);
    expect(
      persisted?.snapshot.operationLedger?.steps[0]?.operations.filter(
        operation => operation.kind === "tool"
      ).map(operation => ({
        state: operation.state,
        toolCallId: operation.toolCallId
      }))
    ).toEqual([
      { state: "cancelled", toolCallId: "call-two" },
      { state: "completed", toolCallId: "call-one" }
    ]);
  });

  test("executes an approved parked tool and continues the same ReAct run", async () => {
    let executions = 0;
    const context = _context("approved-resume-session");
    const store = await _startedStore(context);
    const session = await new AgentRuntime({
      models: _models(),
      project: _project({
        approval: always(),
        onExecute: () => { executions += 1; }
      })
    }).createSession({
      capabilityPolicy: _policy(),
      context,
      executionMode: "react",
      sessionStore: store,
      streamFn: _manualStream
    });
    await session.prompt("hello");
    const pending = await store.load(context.id);
    const request = pending?.snapshot.approvalLedger?.requests[0];
    if (!pending || !request) {
      throw new Error("Expected a pending approval");
    }
    await decideRuntimeToolApproval(store, {
      actor: context.auth,
      decision: "approved",
      expectedVersion: pending.version,
      requestId: request.id,
      runId: context.turn.id,
      sessionId: context.id
    });

    const reloaded = await new AgentRuntime({
      models: _models(),
      project: _project({
        approval: always(),
        onExecute: () => { executions += 1; }
      })
    }).createSession({
      capabilityPolicy: _policy(),
      context,
      executionMode: "react",
      initialMessages: session.messages,
      sessionStore: store,
      streamFn: _manualStream
    });
    await reloaded.resumeApprovedTools();

    const persisted = await store.load(context.id);
    expect(executions).toBe(1);
    expect(reloaded.messages.map(message => message.role)).toEqual([
      "user",
      "assistant",
      "toolResult",
      "assistant"
    ]);
    expect(
      persisted?.snapshot.operationLedger?.steps[0]?.operations.find(
        operation => operation.toolCallId === "call-one"
      )
    ).toMatchObject({ state: "completed" });
  });

  test("requires one approve-and-run decision for a manual gated tool", async () => {
    let executions = 0;
    const context = _context("manual-approval-session");
    const store = await _startedStore(context);
    const runtime = new AgentRuntime({
      models: _models(),
      project: _project({
        approval: always(),
        onExecute: () => { executions += 1; }
      })
    });
    const first = await runtime.createSession({
      capabilityPolicy: _policy(),
      context,
      executionMode: "manual",
      sessionStore: store,
      streamFn: _manualStream
    });
    await first.prompt("hello");
    const pending = await store.load(context.id);
    const request = pending?.snapshot.approvalLedger?.requests[0];
    if (!pending || !request) {
      throw new Error("Expected a pending manual approval");
    }
    expect(executions).toBe(0);

    await decideRuntimeToolApproval(store, {
      actor: context.auth,
      decision: "approved",
      expectedVersion: pending.version,
      requestId: request.id,
      runId: context.turn.id,
      sessionId: context.id
    });
    const reloaded = await runtime.createSession({
      capabilityPolicy: _policy(),
      context,
      executionMode: "manual",
      initialMessages: first.messages,
      sessionStore: store,
      streamFn: _manualStream
    });
    await reloaded.resumeApprovedTools();

    expect(executions).toBe(1);
    expect(reloaded.messages.map(message => message.role)).toEqual([
      "user",
      "assistant",
      "toolResult"
    ]);
  });

  test("expires a parked batch before dispatch when Host approval policy identity changes", async () => {
    let executions = 0;
    const context = _context("stale-approval-session");
    const store = await _startedStore(context);
    const runtime = new AgentRuntime({
      models: _models(),
      project: _project({
        approval: once(),
        onExecute: () => { executions += 1; }
      })
    });
    const first = await runtime.createSession({
      approvalPolicy: { id: "host-approval-v1", evaluate: () => never() },
      capabilityPolicy: _policy(),
      context,
      executionMode: "react",
      sessionStore: store,
      streamFn: _manualStream
    });
    await first.prompt("hello");
    const pending = await store.load(context.id);
    const request = pending?.snapshot.approvalLedger?.requests[0];
    if (!pending || !request) {
      throw new Error("Expected a pending approval");
    }
    await decideRuntimeToolApproval(store, {
      actor: context.auth,
      decision: "approved",
      expectedVersion: pending.version,
      requestId: request.id,
      runId: context.turn.id,
      sessionId: context.id
    });

    const reloaded = await runtime.createSession({
      approvalPolicy: { id: "host-approval-v2", evaluate: () => never() },
      capabilityPolicy: _policy(),
      context,
      executionMode: "react",
      initialMessages: first.messages,
      sessionStore: store,
      streamFn: _manualStream
    });

    let staleError: unknown;
    try {
      await reloaded.resumeApprovedTools();
    } catch (error) {
      staleError = error;
    }
    expect(staleError).toBeInstanceOf(RuntimeToolApprovalStaleError);

    const persisted = await store.load(context.id);
    expect(executions).toBe(0);
    expect(persisted?.snapshot.approvalLedger?.requests[0]).toMatchObject({
      state: "stale"
    });
    expect(persisted?.snapshot.approvalLedger?.grants).toEqual([]);
    expect(
      persisted?.snapshot.operationLedger?.steps[0]?.operations.find(
        operation => operation.toolCallId === "call-one"
      )
    ).toMatchObject({ state: "cancelled" });
  });

  test("resolves a denied approval as an explicit not-run tool result", async () => {
    let executions = 0;
    const context = _context("denied-resume-session");
    const store = await _startedStore(context);
    const runtime = new AgentRuntime({
      models: _models(),
      project: _project({
        approval: always(),
        onExecute: () => { executions += 1; }
      })
    });
    const first = await runtime.createSession({
      capabilityPolicy: _policy(),
      context,
      executionMode: "react",
      sessionStore: store,
      streamFn: _manualStream
    });
    await first.prompt("hello");
    const pending = await store.load(context.id);
    const request = pending?.snapshot.approvalLedger?.requests[0];
    if (!pending || !request) {
      throw new Error("Expected a pending approval");
    }
    await decideRuntimeToolApproval(store, {
      actor: context.auth,
      decision: "denied",
      expectedVersion: pending.version,
      requestId: request.id,
      runId: context.turn.id,
      sessionId: context.id
    });
    const reloaded = await runtime.createSession({
      capabilityPolicy: _policy(),
      context,
      executionMode: "react",
      initialMessages: first.messages,
      sessionStore: store,
      streamFn: _manualStream
    });

    await reloaded.resumeApprovedTools();

    const persisted = await store.load(context.id);
    expect(executions).toBe(0);
    expect(reloaded.messages.find(message =>
      message.role === "toolResult" && message.toolCallId === "call-one")).toMatchObject({ isError: true });
    expect(
      persisted?.snapshot.operationLedger?.steps[0]?.operations.find(
        operation => operation.toolCallId === "call-one"
      )
    ).toMatchObject({ state: "cancelled" });
  });

  test("aborts the Pi Agent run and settles after terminal persistence", async () => {
    let activeSignal: AbortSignal | undefined;
    let markStarted: () => void = () => {};
    const started = new Promise<void>(resolve => {
      markStarted = resolve;
    });
    const events: string[] = [];
    const persisted: AgentMessage[][] = [];
    const streamFn: StreamFn = (_model, _context, options) => {
      activeSignal = options?.signal;
      const stream = createAssistantMessageEventStream();
      const partial = _assistant([], "stop");
      stream.push({ type: "start", partial });
      options?.signal?.addEventListener(
        "abort",
        () => {
          stream.push({
            type: "error",
            reason: "aborted",
            error: {
              ...partial,
              stopReason: "aborted",
              errorMessage: "aborted"
            }
          });
        },
        { once: true }
      );
      markStarted();
      return stream;
    };
    const session = await _runtime().createSession({
      capabilityPolicy: _policy(),
      context: _context("abort-session"),
      persistence: {
        replaceMessages(messages) {
          persisted.push(messages);
        }
      },
      streamFn
    });
    session.subscribe(event => {
      events.push(event.type);
    });

    const running = session.prompt("hello");
    await started;
    session.abort();
    await running;
    await session.waitForIdle();

    expect(activeSignal?.aborted).toBe(true);
    expect(session.messages.at(-1)).toMatchObject({
      role: "assistant",
      stopReason: "aborted"
    });
    expect(persisted.at(-1)?.at(-1)).toMatchObject({
      role: "assistant",
      stopReason: "aborted"
    });
    expect(events.at(-1)).toBe("agent_end");
  });
});

function _runtime(): AgentRuntime {
  return new AgentRuntime({ models: _models(), project: _project() });
}

async function _startedStore(
  context: ReturnType<typeof _context>
): Promise<InMemorySessionStore> {
  const store = new InMemorySessionStore();
  await store.commit({
    sessionId: context.id,
    expectedVersion: null,
    mutations: [{
      type: "startRun",
      runId: context.turn.id,
      messages: [],
      configuration: {
        id: `configuration-${context.id}`,
        agentSnapshotFingerprint: "snapshot-approval",
        contextFingerprint: "context-approval",
        executionMode: "react",
        model: { provider: "fake", id: "fake-model" },
        toolConfigurationFingerprint: "tools-approval"
      }
    }]
  });
  return store;
}

function _policy() {
  return {
    connectionContributions: [],
    modelOptions: {},
    models: [{ provider: "fake", id: "fake-model" }],
    reasoning: ["off", "minimal", "low", "medium", "high", "xhigh"] as const,
    toolContributions: ["tool:echo"]
  };
}

function _context(id: string) {
  const principal = {
    issuer: "test",
    principalId: "session-test",
    principalType: "runtime" as const
  };
  return {
    id,
    auth: { initiator: principal, current: principal },
    channel: { kind: "test" },
    turn: { id: `turn-${id}`, sequence: 1 }
  };
}

function _models(): Models {
  return {
    getModel(provider: string, id: string) {
      return provider === "fake" && id === "fake-model"
        ? _fakeModel()
        : undefined;
    }
  } as unknown as Models;
}

function _fakeModel(): Model<"fake"> {
  return {
    id: "fake-model",
    name: "Fake Model",
    api: "fake",
    provider: "fake",
    baseUrl: "http://localhost.invalid",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 4_096
  };
}

function _project(options: {
  approval?: Approval;
  onExecute?: () => void;
} = {}): AgentProjectSnapshot {
  return {
    root: "/agent",
    definition: { model: { provider: "fake", id: "fake-model" } },
    instructions: "Test agent.",
    tools: [
      {
        name: "echo",
        label: "Echo",
        description: "Echo input.",
        parameters: {
          type: "object",
          properties: { text: { type: "string" } },
          required: ["text"],
          additionalProperties: false
        },
        ...(options.approval ? { approval: options.approval } : {}),
        async execute() {
          options.onExecute?.();
          return {
            content: [{ type: "text", text: "should not run in manual" }],
            details: undefined
          };
        }
      }
    ],
    connections: [],
    resources: { skills: [] },
    diagnostics: [],
    fingerprint: "snapshot-one"
  };
}

function _manualStream(
  _model: Model<Api>,
  context: Context
) {
  const hasToolResult = context.messages.at(-1)?.role === "toolResult";
  return _completedStream(
    hasToolResult
      ? _assistant([{ type: "text", text: "done" }], "stop")
      : _assistant(
        [
          {
            type: "toolCall",
            id: "call-one",
            name: "echo",
            arguments: { text: "hello" }
          }
        ],
        "toolUse"
      )
  );
}

function _stoppedStream() {
  return _completedStream(
    _assistant([{ type: "text", text: "done" }], "stop")
  );
}

function _parallelToolStream() {
  return _completedStream(_assistant(
    [
      {
        type: "toolCall",
        id: "call-one",
        name: "echo",
        arguments: { text: "first" }
      },
      {
        type: "toolCall",
        id: "call-two",
        name: "echo",
        arguments: { text: "second" }
      }
    ],
    "toolUse"
  ));
}

function _completedStream(message: AssistantMessage) {
  const stream = createAssistantMessageEventStream();
  queueMicrotask(() => {
    stream.push({ type: "start", partial: message });
    stream.push({
      type: "done",
      reason: message.stopReason === "toolUse" ? "toolUse" : "stop",
      message
    });
  });
  return stream;
}

function _assistant(
  content: AssistantMessage["content"],
  stopReason: AssistantMessage["stopReason"]
): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: "fake",
    provider: "fake",
    model: "fake-model",
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
    },
    stopReason,
    timestamp: Date.now()
  };
}

function _toolResult(): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId: "call-one",
    toolName: "echo",
    content: [{ type: "text", text: "echo:hello" }],
    isError: false,
    timestamp: Date.now()
  };
}
