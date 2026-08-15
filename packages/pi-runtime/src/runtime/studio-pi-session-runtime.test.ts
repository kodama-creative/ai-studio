import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createModels, type AssistantMessage } from "@earendil-works/pi-ai";
import { defineTool, type ToolContext } from "@llm-space/agent/tools";

import { BunSqliteRuntimeBindingStore } from "../bindings/bun-sqlite-runtime-binding-store";
import { PiAssistantExecutor } from "../model/pi-assistant-executor";
import { BunSqliteSessionRepository } from "../sqlite/bun-sqlite-session-repository";

import {
  DurablePiRuntime,
  DurableEffectCrash,
  DurableSessionCorruptionError,
  OperationAdmissionConflictError,
  StaleSemanticActionError,
  runtimeTool,
  type AssistantExecutor,
} from "./studio-pi-session-runtime";

const ASSISTANT: AssistantMessage = {
  role: "assistant",
  content: [{ type: "text", text: "Durable answer" }],
  api: "openai-responses",
  provider: "openai",
  model: "gpt-5",
  usage: {
    input: 10,
    output: 4,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 14,
    cost: { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0, total: 0.3 },
  },
  stopReason: "stop",
  timestamp: 1,
};

test("opens without effects and commits exactly one durable model step", async () => {
  const root = await mkdtemp(join(tmpdir(), "llm-space-pi-runtime-"));
  const path = join(root, "studio.sqlite");
  const repository = new BunSqliteSessionRepository({ path });
  const bindings = new BunSqliteRuntimeBindingStore({ path });
  let modelCalls = 0;
  const assistantExecutor: AssistantExecutor = {
    execute() {
      modelCalls += 1;
      return Promise.resolve(structuredClone(ASSISTANT));
    },
  };
  const runtime = new DurablePiRuntime({
    repository,
    bindings,
    assistantExecutor,
  });
  try {
    await runtime.createSession({ id: "session-1" });
    const started = await runtime.start({
      operationId: "run-1",
      sessionId: "session-1",
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "Hello" }],
          timestamp: 1,
        },
      ],
      binding: {
        formatVersion: 1,
        agent: { agentSpecId: "assistant", sourceRevision: "abc123" },
        model: { provider: "openai", modelId: "gpt-5" },
        systemPrompt: "You are precise.",
        tools: [],
      },
    });

    expect(modelCalls).toBe(0);
    expect(started.nextAction?.kind).toBe("model");
    expect((await runtime.open({ sessionId: "session-1" })).nextAction).toEqual(
      started.nextAction
    );
    expect(modelCalls).toBe(0);

    const completed = await runtime.step({
      sessionId: "session-1",
      expectedActionId: started.nextAction!.id,
      kind: "model",
    });
    expect(modelCalls).toBe(1);
    expect(completed.status).toBe("completed");
    expect(completed.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
    ]);
    expect(completed.messages[1]).toEqual(ASSISTANT);
  } finally {
    bindings.close();
    await repository.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("resolves a dynamic operation binding once and reuses the frozen result after restart", async () => {
  const root = await mkdtemp(join(tmpdir(), "llm-space-pi-dynamic-binding-"));
  const path = join(root, "studio.sqlite");
  const repository = new BunSqliteSessionRepository({ path });
  const bindings = new BunSqliteRuntimeBindingStore({ path });
  const observedPrompts: string[] = [];
  const createRuntime = () =>
    new DurablePiRuntime({
      repository,
      bindings,
      assistantExecutor: {
        execute({ binding }) {
          observedPrompts.push(binding.systemPrompt);
          return Promise.resolve(structuredClone(ASSISTANT));
        },
      },
    });
  let runtime = createRuntime();
  let resolutions = 0;
  try {
    await runtime.createSession({ id: "dynamic-binding" });
    const input = {
      operationId: "run-dynamic-binding",
      sessionId: "dynamic-binding",
      messages: [{ role: "user" as const, content: "hello", timestamp: 1 }],
    };
    const paused = await runtime.start({
      ...input,
      binding: () => {
        resolutions += 1;
        return Promise.resolve({
          formatVersion: 1,
          agent: { agentSpecId: "assistant", sourceRevision: "revision-1" },
          model: { provider: "openai", modelId: "gpt-5" },
          systemPrompt: "Frozen dynamic instructions",
          tools: [],
        });
      },
    });
    expect(resolutions).toBe(1);
    await runtime.close();

    runtime = createRuntime();
    const recovered = await runtime.start({
      ...input,
      binding: () => {
        resolutions += 1;
        throw new Error("dynamic binding must not resolve again");
      },
    });
    expect(resolutions).toBe(1);
    expect(recovered.nextAction).toEqual(paused.nextAction);
    await runtime.step({
      sessionId: input.sessionId,
      expectedActionId: recovered.nextAction!.id,
      kind: "model",
    });
    expect(observedPrompts).toEqual(["Frozen dynamic instructions"]);
  } finally {
    await runtime.close();
    bindings.close();
    await repository.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("reconstructs a committed step response after process restart", async () => {
  const root = await mkdtemp(join(tmpdir(), "llm-space-pi-step-retry-"));
  const path = join(root, "studio.sqlite");
  let repository = new BunSqliteSessionRepository({ path });
  let bindings = new BunSqliteRuntimeBindingStore({ path });
  let modelCalls = 0;
  const createRuntime = () =>
    new DurablePiRuntime({
      repository,
      bindings,
      assistantExecutor: {
        execute() {
          modelCalls += 1;
          return Promise.resolve(structuredClone(ASSISTANT));
        },
      },
    });
  let runtime = createRuntime();
  try {
    await runtime.createSession({ id: "step-retry" });
    const paused = await runtime.start({
      operationId: "run-step-retry",
      sessionId: "step-retry",
      messages: [{ role: "user", content: "retry", timestamp: 1 }],
      binding: {
        formatVersion: 1,
        agent: { agentSpecId: "assistant", sourceRevision: "abc123" },
        model: { provider: "openai", modelId: "gpt-5" },
        systemPrompt: "Reconstruct a lost response.",
        tools: [],
      },
    });
    const expectedActionId = paused.nextAction!.id;
    const completed = await runtime.step({
      sessionId: "step-retry",
      expectedActionId,
      kind: "model",
    });
    expect(completed.status).toBe("completed");

    await runtime.close();
    bindings.close();
    await repository.close();
    repository = new BunSqliteSessionRepository({ path });
    bindings = new BunSqliteRuntimeBindingStore({ path });
    runtime = createRuntime();

    const replayed = await runtime.step({
      sessionId: "step-retry",
      expectedActionId,
      kind: "model",
    });
    expect(replayed).toEqual(completed);
    expect(modelCalls).toBe(1);
    expect(
      await _rejectionOf(
        runtime.step({
          sessionId: "step-retry",
          expectedActionId: "unknown-action",
          kind: "model",
        })
      )
    ).toBeInstanceOf(StaleSemanticActionError);
  } finally {
    await runtime.close();
    bindings.close();
    await repository.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("reconnects a committed watcher from the last durable sequence", async () => {
  const root = await mkdtemp(join(tmpdir(), "llm-space-pi-watch-"));
  const path = join(root, "studio.sqlite");
  const repository = new BunSqliteSessionRepository({ path });
  const bindings = new BunSqliteRuntimeBindingStore({ path });
  const runtime = new DurablePiRuntime({
    repository,
    bindings,
    assistantExecutor: { execute: () => Promise.resolve(ASSISTANT) },
  });
  try {
    const created = await runtime.createSession({ id: "watch" });
    await runtime.start({
      operationId: "run-watch",
      sessionId: "watch",
      messages: [{ role: "user", content: "watch", timestamp: 1 }],
      binding: {
        formatVersion: 1,
        agent: { agentSpecId: "assistant", sourceRevision: "abc123" },
        model: { provider: "openai", modelId: "gpt-5" },
        systemPrompt: "Watch commits.",
        tools: [],
      },
    });

    const inspected = await runtime.readCommitted({
      sessionId: "watch",
      afterSeq: created.cursor,
    });
    expect(inspected.cursor).toBeGreaterThan(created.cursor);
    expect(inspected.fromCursor).toBe(created.cursor);
    expect(inspected.items.length).toBeGreaterThan(0);
    expect(inspected.snapshot.status).toBe("paused");

    const firstWatch = runtime.watch({
      sessionId: "watch",
      afterSeq: created.cursor,
      pollIntervalMs: 1,
    });
    const admitted = await firstWatch.next();
    expect(admitted.done).toBe(false);
    expect(admitted.value?.fromCursor).toBe(created.cursor);
    expect(admitted.value?.snapshot.status).toBe("paused");
    expect(admitted.value?.items.length).toBeGreaterThan(0);
    await firstWatch.return(undefined);

    const paused = await runtime.open({ sessionId: "watch" });
    await runtime.step({
      sessionId: "watch",
      expectedActionId: paused.nextAction!.id,
      kind: "model",
    });
    const resumedWatch = runtime.watch({
      sessionId: "watch",
      afterSeq: admitted.value!.cursor,
      pollIntervalMs: 1,
    });
    const completed = await resumedWatch.next();
    expect(completed.value?.cursor).toBeGreaterThan(admitted.value!.cursor);
    expect(completed.value?.snapshot.status).toBe("completed");
    expect(
      completed.value?.items.some(
        (item) =>
          item.kind === "record" && item.record.type === "operation_finished"
      )
    ).toBe(true);
    await resumedWatch.return(undefined);
  } finally {
    await runtime.close();
    bindings.close();
    await repository.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("close interrupts live effects without persisting user abort intent", async () => {
  const root = await mkdtemp(join(tmpdir(), "llm-space-pi-close-"));
  const path = join(root, "studio.sqlite");
  const repository = new BunSqliteSessionRepository({ path });
  const bindings = new BunSqliteRuntimeBindingStore({ path });
  let effectStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    effectStarted = resolve;
  });
  const runtime = new DurablePiRuntime({
    repository,
    bindings,
    assistantExecutor: {
      execute({ signal }) {
        effectStarted();
        return new Promise<AssistantMessage>((resolve) => {
          signal.addEventListener(
            "abort",
            () => resolve({ ...ASSISTANT, stopReason: "aborted" }),
            { once: true }
          );
        });
      },
    },
  });
  try {
    await runtime.createSession({ id: "close" });
    const paused = await runtime.start({
      operationId: "run-close",
      sessionId: "close",
      messages: [{ role: "user", content: "close", timestamp: 1 }],
      binding: {
        formatVersion: 1,
        agent: { agentSpecId: "assistant", sourceRevision: "abc123" },
        model: { provider: "openai", modelId: "gpt-5" },
        systemPrompt: "Close cleanly.",
        tools: [],
      },
    });
    const step = runtime.step({
      sessionId: "close",
      expectedActionId: paused.nextAction!.id,
      kind: "model",
    });
    await started;
    await runtime.close();
    expect(await _rejectionOf(step)).toBeDefined();

    const inspected = await repository.open((await repository.list())[0]!);
    const records = await inspected.findRecords({ runId: "run-close" });
    expect(records.some((record) => record.type === "abort_requested")).toBe(
      false
    );
    expect(records.some((record) => record.type === "operation_finished")).toBe(
      false
    );
    expect(
      (await _rejectionOf(runtime.open({ sessionId: "close" }))) as Error
    ).toHaveProperty("message", "Pi Session runtime is closed.");
  } finally {
    bindings.close();
    await repository.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("close preserves a started tool prefix for durable recovery", async () => {
  const root = await mkdtemp(join(tmpdir(), "llm-space-pi-close-tool-"));
  const path = join(root, "studio.sqlite");
  let repository = new BunSqliteSessionRepository({ path });
  let bindings = new BunSqliteRuntimeBindingStore({ path });
  let toolCalls = 0;
  let effectStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    effectStarted = resolve;
  });
  const tool = defineTool({
    description: "Wait for runtime shutdown",
    inputSchema: { type: "object", additionalProperties: false },
    execute(_input, context) {
      toolCalls += 1;
      effectStarted();
      return new Promise<string>((resolve) => {
        context.abortSignal.addEventListener("abort", () => resolve("late"), {
          once: true,
        });
      });
    },
  });
  const createRuntime = () =>
    new DurablePiRuntime({
      repository,
      bindings,
      assistantExecutor: {
        execute: () =>
          Promise.resolve({
            ...ASSISTANT,
            content: [
              {
                type: "toolCall",
                id: "close-tool-call",
                name: "close-tool",
                arguments: {},
              },
            ],
            stopReason: "toolUse",
          }),
      },
      resolveTools: () =>
        new Map([
          [
            "close-tool",
            runtimeTool(tool, { implementationId: "close-tool@1" }),
          ],
        ]),
      createToolContext: _unusedToolContext,
    });
  let runtime = createRuntime();
  try {
    await runtime.createSession({ id: "close-tool" });
    let snapshot = await runtime.start({
      operationId: "run-close-tool",
      sessionId: "close-tool",
      messages: [{ role: "user", content: "close tool", timestamp: 1 }],
      binding: {
        formatVersion: 1,
        agent: { agentSpecId: "assistant", sourceRevision: "abc123" },
        model: { provider: "openai", modelId: "gpt-5" },
        systemPrompt: "Close during a tool effect.",
        tools: [
          {
            name: "close-tool",
            implementationId: "close-tool@1",
            replay: "never",
          },
        ],
      },
    });
    snapshot = await runtime.step({
      sessionId: "close-tool",
      expectedActionId: snapshot.nextAction!.id,
      kind: "model",
    });
    const step = runtime.step({
      sessionId: "close-tool",
      expectedActionId: snapshot.nextAction!.id,
      kind: "tool",
    });
    await started;
    await runtime.close();
    expect(await _rejectionOf(step)).toBeDefined();

    const inspected = await repository.open((await repository.list())[0]!);
    const records = await inspected.findRecords({ runId: "run-close-tool" });
    const toolStarted = records.find(
      (record) => record.type === "tool_started"
    );
    if (toolStarted?.type !== "tool_started") {
      throw new Error("Expected a durable tool_started record.");
    }
    expect(records.some((record) => record.type === "abort_requested")).toBe(
      false
    );
    expect(records.some((record) => record.type === "operation_finished")).toBe(
      false
    );
    expect(await inspected.getEntry(toolStarted.resultEntryId)).toBeUndefined();

    bindings.close();
    await repository.close();
    repository = new BunSqliteSessionRepository({ path });
    bindings = new BunSqliteRuntimeBindingStore({ path });
    runtime = createRuntime();

    const recovered = await runtime.open({ sessionId: "close-tool" });
    const afterRecovery = await runtime.step({
      sessionId: "close-tool",
      expectedActionId: recovered.nextAction!.id,
      kind: "tool",
    });
    expect(toolCalls).toBe(1);
    expect(afterRecovery.messages.at(-1)).toMatchObject({
      role: "toolResult",
      toolCallId: "close-tool-call",
      isError: true,
    });
  } finally {
    await runtime.close();
    bindings.close();
    await repository.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("recovers a durable user approval before executing a tool exactly once", async () => {
  const root = await mkdtemp(join(tmpdir(), "llm-space-pi-tool-approval-"));
  const path = join(root, "studio.sqlite");
  let repository = new BunSqliteSessionRepository({ path });
  let bindings = new BunSqliteRuntimeBindingStore({ path });
  let assistantCalls = 0;
  let approvalCalls = 0;
  let toolCalls = 0;
  const tool = defineTool({
    description: "Deploy the release",
    inputSchema: {
      type: "object",
      properties: { environment: { type: "string" } },
      required: ["environment"],
      additionalProperties: false,
    },
    approval() {
      approvalCalls += 1;
      return "user-approval";
    },
    execute(input) {
      toolCalls += 1;
      return `deployed:${String(input.environment)}`;
    },
  });
  const createRuntime = () =>
    new DurablePiRuntime({
      repository,
      bindings,
      assistantExecutor: {
        execute() {
          assistantCalls += 1;
          return Promise.resolve(
            assistantCalls === 1
              ? {
                  ...ASSISTANT,
                  content: [
                    {
                      type: "toolCall" as const,
                      id: "deploy-call",
                      name: "deploy",
                      arguments: { environment: "production" },
                    },
                  ],
                  stopReason: "toolUse" as const,
                }
              : structuredClone(ASSISTANT)
          );
        },
      },
      resolveTools: () =>
        new Map([
          ["deploy", runtimeTool(tool, { implementationId: "deploy@1" })],
        ]),
      createToolContext: _unusedToolContext,
    });
  let runtime = createRuntime();
  try {
    await runtime.createSession({ id: "approval" });
    let snapshot = await runtime.start({
      operationId: "run-approval",
      sessionId: "approval",
      messages: [{ role: "user", content: "deploy", timestamp: 1 }],
      binding: {
        formatVersion: 1,
        agent: { agentSpecId: "assistant", sourceRevision: "abc123" },
        model: { provider: "openai", modelId: "gpt-5" },
        systemPrompt: "Deploy carefully.",
        tools: [
          {
            name: "deploy",
            description: "Deploy the release",
            inputSchema: tool.inputSchema as Readonly<Record<string, unknown>>,
            implementationId: "deploy@1",
            replay: "never",
          },
        ],
      },
    });
    snapshot = await runtime.step({
      sessionId: "approval",
      expectedActionId: snapshot.nextAction!.id,
      kind: "model",
    });
    snapshot = await runtime.step({
      sessionId: "approval",
      expectedActionId: snapshot.nextAction!.id,
      kind: "tool",
    });
    expect(snapshot).toMatchObject({
      status: "suspended",
      approval: {
        toolCallId: "deploy-call",
        toolName: "deploy",
        status: "pending",
      },
    });
    expect(toolCalls).toBe(0);
    expect(approvalCalls).toBe(1);

    await runtime.close();
    bindings.close();
    await repository.close();
    repository = new BunSqliteSessionRepository({ path });
    bindings = new BunSqliteRuntimeBindingStore({ path });
    runtime = createRuntime();

    expect(await runtime.open({ sessionId: "approval" })).toMatchObject({
      status: "suspended",
      approval: { toolCallId: "deploy-call", status: "pending" },
    });
    await runtime.resolveToolApproval({
      sessionId: "approval",
      toolCallId: "deploy-call",
      approved: true,
    });
    const completed = await runtime.continue({ sessionId: "approval" });
    expect(completed.status).toBe("completed");
    expect(toolCalls).toBe(1);
    expect(approvalCalls).toBe(1);
  } finally {
    await runtime.close();
    bindings.close();
    await repository.close();
    await rm(root, { recursive: true, force: true });
  }
});

/** Captures a required rejection so Bun tests await the actual async outcome. */
async function _rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("Expected the promise to reject.");
}

test("suspends a missing frozen model before writing a provider attempt", async () => {
  const root = await mkdtemp(join(tmpdir(), "llm-space-pi-model-identity-"));
  const path = join(root, "studio.sqlite");
  const repository = new BunSqliteSessionRepository({ path });
  const bindings = new BunSqliteRuntimeBindingStore({ path });
  const runtime = new DurablePiRuntime({
    repository,
    bindings,
    assistantExecutor: new PiAssistantExecutor({ models: createModels() }),
  });
  try {
    await runtime.createSession({ id: "missing-model" });
    const snapshot = await runtime.start({
      operationId: "run-missing-model",
      sessionId: "missing-model",
      messages: [{ role: "user", content: "hello", timestamp: 1 }],
      binding: {
        formatVersion: 1,
        agent: { agentSpecId: "assistant", sourceRevision: "abc123" },
        model: { provider: "missing", modelId: "missing" },
        systemPrompt: "Stay suspended.",
        tools: [],
      },
    });

    expect(snapshot.status).toBe("suspended");
    expect(snapshot.suspension?.code).toBe("missing_model_identity");
    expect(snapshot.nextAction).toBeUndefined();
    const inspected = await repository.list();
    const session = await repository.open(inspected[0]!);
    expect(
      await session.findRecords({
        runId: "run-missing-model",
        type: "step_attempt",
      })
    ).toEqual([]);
  } finally {
    bindings.close();
    await repository.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("scopes pending tool discovery to the current operation boundary", async () => {
  const root = await mkdtemp(join(tmpdir(), "llm-space-pi-operation-scope-"));
  const path = join(root, "studio.sqlite");
  let repository = new BunSqliteSessionRepository({ path });
  const seeded = await repository.create({ id: "operation-scope" });
  await seeded.appendRecord({
    type: "operation_started",
    id: "old-run",
    lane: "main",
    sourceLeafId: null,
    intent: {
      kind: "run",
      originalPrompt: [],
      initialMessages: [],
    },
  });
  await seeded.appendEntry(
    {
      type: "message",
      id: "old-assistant",
      message: {
        ...ASSISTANT,
        content: [
          {
            type: "toolCall",
            id: "old-call",
            name: "old-tool",
            arguments: {},
          },
        ],
        stopReason: "toolUse",
      },
    },
    "main"
  );
  await seeded.appendRecord({
    type: "operation_finished",
    id: "old-run:finished",
    lane: "main",
    runId: "old-run",
    outcome: "failed",
  });
  await repository.close();

  repository = new BunSqliteSessionRepository({ path });
  const bindings = new BunSqliteRuntimeBindingStore({ path });
  let modelCalls = 0;
  const runtime = new DurablePiRuntime({
    repository,
    bindings,
    assistantExecutor: {
      execute() {
        modelCalls += 1;
        return Promise.resolve(ASSISTANT);
      },
    },
  });
  try {
    const snapshot = await runtime.start({
      operationId: "new-run",
      sessionId: "operation-scope",
      messages: [{ role: "user", content: "new work", timestamp: 2 }],
      binding: {
        formatVersion: 1,
        agent: { agentSpecId: "assistant", sourceRevision: "def456" },
        model: { provider: "openai", modelId: "gpt-5" },
        systemPrompt: "Ignore old unfinished calls.",
        tools: [],
      },
    });

    expect(snapshot.status).toBe("paused");
    expect(snapshot.nextAction?.kind).toBe("model");
    expect(modelCalls).toBe(0);
  } finally {
    bindings.close();
    await repository.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("steps local tools sequentially and exposes Pi execution identity", async () => {
  const root = await mkdtemp(join(tmpdir(), "llm-space-pi-tools-"));
  const path = join(root, "studio.sqlite");
  const repository = new BunSqliteSessionRepository({ path });
  const bindings = new BunSqliteRuntimeBindingStore({ path });
  const observed: ToolContext["execution"][] = [];
  let modelTurn = 0;
  const runtime = new DurablePiRuntime({
    repository,
    bindings,
    assistantExecutor: {
      execute() {
        modelTurn += 1;
        return Promise.resolve(
          modelTurn === 1
            ? {
                ...ASSISTANT,
                content: [
                  {
                    type: "toolCall" as const,
                    id: "call-a",
                    name: "echo",
                    arguments: { value: "a" },
                  },
                  {
                    type: "toolCall" as const,
                    id: "call-b",
                    name: "echo",
                    arguments: { value: "b" },
                  },
                ],
                stopReason: "toolUse" as const,
              }
            : {
                ...ASSISTANT,
                content: [{ type: "text" as const, text: "done" }],
              }
        );
      },
    },
    resolveTools: () =>
      new Map([
        [
          "echo",
          runtimeTool(
            defineTool({
              description: "Echo a value",
              inputSchema: {
                type: "object",
                properties: { value: { type: "string" } },
                required: ["value"],
                additionalProperties: false,
              },
              execute(input: { value: string }, context) {
                observed.push(context.execution);
                return input.value;
              },
            }),
            { implementationId: "echo@1" }
          ),
        ],
      ]),
    createToolContext: ({ execution, signal }) => ({
      execution,
      abortSignal: signal,
      getSandbox: () => Promise.reject(new Error("unused")),
      getSkill: () => {
        throw new Error("unused");
      },
      getToken: () => Promise.reject(new Error("unused")),
      requireAuth: () => {
        throw new Error("unused");
      },
    }),
  });
  try {
    await runtime.createSession({ id: "tools" });
    let snapshot = await runtime.start({
      operationId: "run-tools",
      sessionId: "tools",
      messages: [{ role: "user", content: "go", timestamp: 1 }],
      binding: {
        formatVersion: 1,
        agent: { agentSpecId: "assistant", sourceRevision: "abc123" },
        model: { provider: "openai", modelId: "gpt-5" },
        systemPrompt: "Use tools.",
        tools: [{ name: "echo", implementationId: "echo@1", replay: "never" }],
      },
    });
    snapshot = await runtime.step({
      sessionId: "tools",
      expectedActionId: snapshot.nextAction!.id,
      kind: "model",
    });
    expect(snapshot.nextAction).toMatchObject({ kind: "tool", toolIndex: 0 });
    snapshot = await runtime.step({
      sessionId: "tools",
      expectedActionId: snapshot.nextAction!.id,
      kind: "tool",
    });
    expect(snapshot.nextAction).toMatchObject({ kind: "tool", toolIndex: 1 });
    expect(observed).toHaveLength(1);
    expect(observed[0]).toMatchObject({
      sessionId: "tools",
      lane: "main",
      runId: "run-tools",
      toolIndex: 0,
      toolCallId: "call-a",
      toolName: "echo",
    });
    expect(observed[0]!.idempotencyKey).toContain("run-tools");
  } finally {
    bindings.close();
    await repository.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("does not replay a never tool after a crash past tool_started", async () => {
  const root = await mkdtemp(join(tmpdir(), "llm-space-pi-crash-"));
  const path = join(root, "studio.sqlite");
  let repository = new BunSqliteSessionRepository({ path });
  let bindings = new BunSqliteRuntimeBindingStore({ path });
  let calls = 0;
  const tool = defineTool({
    description: "Unsafe effect",
    inputSchema: { type: "object", additionalProperties: false },
    execute() {
      calls += 1;
      throw new DurableEffectCrash("simulated process death");
    },
  });
  const createRuntime = () =>
    new DurablePiRuntime({
      repository,
      bindings,
      assistantExecutor: {
        execute: () =>
          Promise.resolve({
            ...ASSISTANT,
            content: [
              {
                type: "toolCall",
                id: "unsafe-call",
                name: "unsafe",
                arguments: {},
              },
            ],
            stopReason: "toolUse",
          }),
      },
      resolveTools: () =>
        new Map([
          ["unsafe", runtimeTool(tool, { implementationId: "unsafe@1" })],
        ]),
      createToolContext: _unusedToolContext,
    });
  let runtime = createRuntime();
  try {
    await runtime.createSession({ id: "crash" });
    let snapshot = await runtime.start({
      operationId: "run-crash",
      sessionId: "crash",
      messages: [{ role: "user", content: "go", timestamp: 1 }],
      binding: {
        formatVersion: 1,
        agent: { agentSpecId: "assistant", sourceRevision: "abc123" },
        model: { provider: "openai", modelId: "gpt-5" },
        systemPrompt: "Use tools.",
        tools: [
          { name: "unsafe", implementationId: "unsafe@1", replay: "never" },
        ],
      },
    });
    snapshot = await runtime.step({
      sessionId: "crash",
      expectedActionId: snapshot.nextAction!.id,
      kind: "model",
    });
    expect(
      runtime.step({
        sessionId: "crash",
        expectedActionId: snapshot.nextAction!.id,
        kind: "tool",
      })
    ).rejects.toBeInstanceOf(DurableEffectCrash);
    expect(calls).toBe(1);

    bindings.close();
    await repository.close();
    repository = new BunSqliteSessionRepository({ path });
    bindings = new BunSqliteRuntimeBindingStore({ path });
    runtime = createRuntime();

    const recovered = await runtime.open({ sessionId: "crash" });
    const afterRecovery = await runtime.step({
      sessionId: "crash",
      expectedActionId: recovered.nextAction!.id,
      kind: "tool",
    });
    expect(calls).toBe(1);
    expect(afterRecovery.messages.at(-1)).toMatchObject({
      role: "toolResult",
      isError: true,
      toolCallId: "unsafe-call",
    });
    expect(afterRecovery.nextAction?.kind).toBe("model");
  } finally {
    bindings.close();
    await repository.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("retries a provider error inside one durable model step", async () => {
  const root = await mkdtemp(join(tmpdir(), "llm-space-pi-retry-"));
  const path = join(root, "studio.sqlite");
  const repository = new BunSqliteSessionRepository({ path });
  const bindings = new BunSqliteRuntimeBindingStore({ path });
  let attempts = 0;
  const runtime = new DurablePiRuntime({
    repository,
    bindings,
    assistantExecutor: {
      execute() {
        attempts += 1;
        return Promise.resolve(
          attempts === 1
            ? {
                ...ASSISTANT,
                content: [],
                stopReason: "error",
                errorMessage: "temporary provider failure",
              }
            : ASSISTANT
        );
      },
    },
  });
  try {
    await runtime.createSession({ id: "retry" });
    const started = await runtime.start({
      operationId: "run-retry",
      sessionId: "retry",
      messages: [{ role: "user", content: "go", timestamp: 1 }],
      binding: {
        formatVersion: 1,
        agent: { agentSpecId: "assistant", sourceRevision: "abc123" },
        model: { provider: "openai", modelId: "gpt-5" },
        systemPrompt: "Retry.",
        tools: [],
      },
    });
    const completed = await runtime.step({
      sessionId: "retry",
      expectedActionId: started.nextAction!.id,
      kind: "model",
    });
    expect(attempts).toBe(2);
    expect(completed.status).toBe("completed");
    expect(completed.messages.at(-1)).toEqual(ASSISTANT);
  } finally {
    bindings.close();
    await repository.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("replays only an explicitly safe tool with the same idempotency key", async () => {
  const root = await mkdtemp(join(tmpdir(), "llm-space-pi-safe-replay-"));
  const path = join(root, "studio.sqlite");
  const repository = new BunSqliteSessionRepository({ path });
  const bindings = new BunSqliteRuntimeBindingStore({ path });
  const keys: string[] = [];
  let calls = 0;
  const safe = defineTool({
    description: "Idempotent effect",
    replay: "safe",
    inputSchema: { type: "object", additionalProperties: false },
    execute(_input, context) {
      calls += 1;
      keys.push(context.execution.idempotencyKey);
      if (calls === 1) throw new DurableEffectCrash("simulated process death");
      return "recovered";
    },
  });
  const runtime = new DurablePiRuntime({
    repository,
    bindings,
    assistantExecutor: {
      execute: () =>
        Promise.resolve({
          ...ASSISTANT,
          content: [
            { type: "toolCall", id: "safe-call", name: "safe", arguments: {} },
          ],
          stopReason: "toolUse",
        }),
    },
    resolveTools: () =>
      new Map([["safe", runtimeTool(safe, { implementationId: "safe@1" })]]),
    createToolContext: ({ execution, signal }) => ({
      execution,
      abortSignal: signal,
      getSandbox: () => Promise.reject(new Error("unused")),
      getSkill: () => {
        throw new Error("unused");
      },
      getToken: () => Promise.reject(new Error("unused")),
      requireAuth: () => {
        throw new Error("unused");
      },
    }),
  });
  try {
    await runtime.createSession({ id: "safe-replay" });
    let snapshot = await runtime.start({
      operationId: "run-safe",
      sessionId: "safe-replay",
      messages: [{ role: "user", content: "go", timestamp: 1 }],
      binding: {
        formatVersion: 1,
        agent: { agentSpecId: "assistant", sourceRevision: "abc123" },
        model: { provider: "openai", modelId: "gpt-5" },
        systemPrompt: "Use tools.",
        tools: [{ name: "safe", implementationId: "safe@1", replay: "safe" }],
      },
    });
    snapshot = await runtime.step({
      sessionId: "safe-replay",
      expectedActionId: snapshot.nextAction!.id,
      kind: "model",
    });
    expect(
      runtime.step({
        sessionId: "safe-replay",
        expectedActionId: snapshot.nextAction!.id,
        kind: "tool",
      })
    ).rejects.toBeInstanceOf(DurableEffectCrash);
    const recovered = await runtime.open({ sessionId: "safe-replay" });
    const settled = await runtime.step({
      sessionId: "safe-replay",
      expectedActionId: recovered.nextAction!.id,
      kind: "tool",
    });
    expect(calls).toBe(2);
    expect(keys[0]).toBe(keys[1]);
    expect(settled.messages.at(-1)).toMatchObject({
      role: "toolResult",
      isError: false,
      content: [{ type: "text", text: "recovered" }],
    });
  } finally {
    bindings.close();
    await repository.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("reuses committed tool usage after a crash before result append", async () => {
  const root = await mkdtemp(
    join(tmpdir(), "llm-space-pi-tool-usage-recovery-")
  );
  const path = join(root, "studio.sqlite");
  let repository = new BunSqliteSessionRepository({ path });
  const bindings = new BunSqliteRuntimeBindingStore({ path });
  const binding = bindings.put({
    id: "binding:run-tool-usage-recovery",
    binding: {
      formatVersion: 1,
      agent: { agentSpecId: "assistant", sourceRevision: "abc123" },
      model: { provider: "openai", modelId: "gpt-5" },
      systemPrompt: "Recover accounting.",
      tools: [{ name: "safe", implementationId: "safe@1", replay: "safe" }],
    },
  });
  const seeded = await repository.create({ id: "tool-usage-recovery" });
  const userEntry = {
    type: "message" as const,
    id: "run-tool-usage-recovery:input:0",
    message: { role: "user" as const, content: "go", timestamp: 1 },
  };
  await seeded.appendRecord({
    type: "operation_started",
    id: "run-tool-usage-recovery",
    lane: "main",
    sourceLeafId: null,
    intent: {
      kind: "run",
      originalPrompt: [userEntry.message],
      initialMessages: [userEntry],
      resumeData: { "llm-space": { ...binding } },
    },
  });
  await seeded.appendEntry(userEntry, "main");
  const assistant = {
    ...ASSISTANT,
    content: [
      {
        type: "toolCall" as const,
        id: "safe-call",
        name: "safe",
        arguments: {},
      },
    ],
    stopReason: "toolUse" as const,
  };
  await seeded.appendRecord({
    type: "step_attempt",
    id: "usage-assistant:attempt:1",
    lane: "main",
    runId: "run-tool-usage-recovery",
    step: "assistant",
    attempt: 1,
    resultEntryId: "usage-assistant",
  });
  await seeded.appendEntry(
    { type: "message", id: "usage-assistant", message: assistant },
    "main"
  );
  await seeded.appendRecord({
    type: "tool_started",
    id: "usage-assistant:tool:0:started",
    lane: "main",
    runId: "run-tool-usage-recovery",
    assistantEntryId: "usage-assistant",
    toolIndex: 0,
    toolCallId: "safe-call",
    toolName: "safe",
    effectiveArgs: {},
    resultEntryId: "usage-assistant:tool:0:result",
    replay: "safe",
  });
  await seeded.appendRecord({
    type: "usage",
    id: "usage-assistant:tool:0:result:usage",
    lane: "main",
    runId: "run-tool-usage-recovery",
    cause: "tool",
    entryId: "usage-assistant:tool:0:result",
    toolCallId: "safe-call",
    usage: ASSISTANT.usage,
  });
  await repository.close();

  repository = new BunSqliteSessionRepository({ path });
  const safe = defineTool({
    description: "Idempotent effect",
    replay: "safe",
    inputSchema: { type: "object", additionalProperties: false },
    execute: () => "recovered",
  });
  const runtime = new DurablePiRuntime({
    repository,
    bindings,
    assistantExecutor: { execute: () => Promise.resolve(ASSISTANT) },
    resolveTools: () =>
      new Map([["safe", runtimeTool(safe, { implementationId: "safe@1" })]]),
    createToolContext: _unusedToolContext,
    toolPolicies: { after: () => ({ usage: ASSISTANT.usage }) },
  });
  try {
    const recovered = await runtime.open({ sessionId: "tool-usage-recovery" });
    const settled = await runtime.step({
      sessionId: "tool-usage-recovery",
      expectedActionId: recovered.nextAction!.id,
      kind: "tool",
    });

    expect(settled.messages.at(-1)).toMatchObject({
      role: "toolResult",
      isError: false,
    });
    const inspected = await repository.open((await repository.list())[0]!);
    const usage = (
      await inspected.findRecords({
        runId: "run-tool-usage-recovery",
        type: "usage",
      })
    ).filter((record) => record.cause === "tool");
    expect(usage).toHaveLength(1);
  } finally {
    bindings.close();
    await repository.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("finishes an already committed terminal assistant without another provider call", async () => {
  const root = await mkdtemp(join(tmpdir(), "llm-space-pi-finish-recovery-"));
  const path = join(root, "studio.sqlite");
  const repository = new BunSqliteSessionRepository({ path });
  const bindings = new BunSqliteRuntimeBindingStore({ path });
  const session = await repository.create({ id: "finish-recovery" });
  const binding = bindings.put({
    id: "binding:run-finish-recovery",
    binding: {
      formatVersion: 1,
      agent: { agentSpecId: "assistant", sourceRevision: "abc123" },
      model: { provider: "openai", modelId: "gpt-5" },
      systemPrompt: "Finish safely.",
      tools: [],
    },
  });
  await session.appendRecord({
    type: "operation_started",
    id: "run-finish-recovery",
    lane: "main",
    sourceLeafId: null,
    intent: {
      kind: "run",
      originalPrompt: [],
      initialMessages: [],
      resumeData: { "llm-space": { ...binding } },
    },
  });
  await session.appendRecord({
    type: "step_attempt",
    id: "run-finish-recovery:attempt:1",
    lane: "main",
    runId: "run-finish-recovery",
    step: "assistant",
    attempt: 1,
    resultEntryId: "committed-assistant",
  });
  await session.appendEntry(
    { type: "message", id: "committed-assistant", message: ASSISTANT },
    "main"
  );
  let modelCalls = 0;
  const runtime = new DurablePiRuntime({
    repository,
    bindings,
    assistantExecutor: {
      execute() {
        modelCalls += 1;
        return Promise.resolve(ASSISTANT);
      },
    },
  });
  try {
    const recovered = await runtime.open({ sessionId: "finish-recovery" });
    const settled = await runtime.step({
      sessionId: "finish-recovery",
      expectedActionId: recovered.nextAction!.id,
      kind: "model",
    });
    expect(modelCalls).toBe(0);
    expect(settled.status).toBe("completed");
    expect(settled.messages).toEqual([ASSISTANT]);
  } finally {
    bindings.close();
    await repository.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects conflicting prompt content for an admitted operation id", async () => {
  const root = await mkdtemp(join(tmpdir(), "llm-space-pi-admission-"));
  const path = join(root, "studio.sqlite");
  const repository = new BunSqliteSessionRepository({ path });
  const bindings = new BunSqliteRuntimeBindingStore({ path });
  const runtime = new DurablePiRuntime({
    repository,
    bindings,
    assistantExecutor: { execute: () => Promise.resolve(ASSISTANT) },
  });
  const binding = {
    formatVersion: 1,
    agent: { agentSpecId: "assistant", sourceRevision: "abc123" },
    model: { provider: "openai", modelId: "gpt-5" },
    systemPrompt: "Stable admission.",
    tools: [],
  };
  try {
    await runtime.createSession({ id: "admission" });
    await runtime.start({
      operationId: "same-run",
      sessionId: "admission",
      messages: [{ role: "user", content: "first", timestamp: 1 }],
      binding,
    });
    expect(
      runtime.start({
        operationId: "same-run",
        sessionId: "admission",
        messages: [{ role: "user", content: "different", timestamp: 1 }],
        binding,
      })
    ).rejects.toBeInstanceOf(OperationAdmissionConflictError);
    expect((await runtime.open({ sessionId: "admission" })).messages).toEqual([
      { role: "user", content: "first", timestamp: 1 },
    ]);
  } finally {
    bindings.close();
    await repository.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("never upgrades a frozen never tool to current safe replay", async () => {
  const root = await mkdtemp(join(tmpdir(), "llm-space-pi-frozen-replay-"));
  const path = join(root, "studio.sqlite");
  const repository = new BunSqliteSessionRepository({ path });
  const bindings = new BunSqliteRuntimeBindingStore({ path });
  let calls = 0;
  const tool = defineTool({
    description: "Current code claims safe replay",
    replay: "safe",
    inputSchema: { type: "object", additionalProperties: false },
    execute() {
      calls += 1;
      throw new DurableEffectCrash("simulated process death");
    },
  });
  const runtime = new DurablePiRuntime({
    repository,
    bindings,
    assistantExecutor: {
      execute: () =>
        Promise.resolve({
          ...ASSISTANT,
          content: [
            {
              type: "toolCall",
              id: "frozen-call",
              name: "frozen",
              arguments: {},
            },
          ],
          stopReason: "toolUse",
        }),
    },
    resolveTools: () =>
      new Map([
        ["frozen", runtimeTool(tool, { implementationId: "frozen@1" })],
      ]),
    createToolContext: _unusedToolContext,
  });
  try {
    await runtime.createSession({ id: "frozen-replay" });
    let snapshot = await runtime.start({
      operationId: "run-frozen",
      sessionId: "frozen-replay",
      messages: [{ role: "user", content: "go", timestamp: 1 }],
      binding: {
        formatVersion: 1,
        agent: { agentSpecId: "assistant", sourceRevision: "abc123" },
        model: { provider: "openai", modelId: "gpt-5" },
        systemPrompt: "Use the frozen tool.",
        tools: [
          { name: "frozen", implementationId: "frozen@1", replay: "never" },
        ],
      },
    });
    snapshot = await runtime.step({
      sessionId: "frozen-replay",
      expectedActionId: snapshot.nextAction!.id,
      kind: "model",
    });
    expect(
      runtime.step({
        sessionId: "frozen-replay",
        expectedActionId: snapshot.nextAction!.id,
        kind: "tool",
      })
    ).rejects.toBeInstanceOf(DurableEffectCrash);
    const recovered = await runtime.open({ sessionId: "frozen-replay" });
    await runtime.step({
      sessionId: "frozen-replay",
      expectedActionId: recovered.nextAction!.id,
      kind: "tool",
    });
    expect(calls).toBe(1);
  } finally {
    bindings.close();
    await repository.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("suspends a clean tool breakpoint when implementation identity changed", async () => {
  const root = await mkdtemp(join(tmpdir(), "llm-space-pi-tool-identity-"));
  const path = join(root, "studio.sqlite");
  const repository = new BunSqliteSessionRepository({ path });
  const bindings = new BunSqliteRuntimeBindingStore({ path });
  let calls = 0;
  const changed = defineTool({
    description: "Changed implementation",
    inputSchema: { type: "object", additionalProperties: false },
    execute() {
      calls += 1;
      return "wrong";
    },
  });
  const runtime = new DurablePiRuntime({
    repository,
    bindings,
    assistantExecutor: {
      execute: () =>
        Promise.resolve({
          ...ASSISTANT,
          content: [
            {
              type: "toolCall",
              id: "identity-call",
              name: "identity",
              arguments: {},
            },
          ],
          stopReason: "toolUse",
        }),
    },
    resolveTools: () =>
      new Map([
        ["identity", runtimeTool(changed, { implementationId: "identity@2" })],
      ]),
    createToolContext: _unusedToolContext,
  });
  try {
    await runtime.createSession({ id: "identity" });
    let snapshot = await runtime.start({
      operationId: "run-identity",
      sessionId: "identity",
      messages: [{ role: "user", content: "go", timestamp: 1 }],
      binding: {
        formatVersion: 1,
        agent: { agentSpecId: "assistant", sourceRevision: "abc123" },
        model: { provider: "openai", modelId: "gpt-5" },
        systemPrompt: "Use the exact implementation.",
        tools: [
          { name: "identity", implementationId: "identity@1", replay: "never" },
        ],
      },
    });
    snapshot = await runtime.step({
      sessionId: "identity",
      expectedActionId: snapshot.nextAction!.id,
      kind: "model",
    });
    expect(snapshot.status).toBe("suspended");
    expect(snapshot.suspension?.code).toBe("tool_identity_mismatch");
    expect(snapshot.nextAction).toBeUndefined();
    expect(calls).toBe(0);
  } finally {
    bindings.close();
    await repository.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("materializes a partially committed prompt before the provider effect", async () => {
  const root = await mkdtemp(join(tmpdir(), "llm-space-pi-prompt-recovery-"));
  const path = join(root, "studio.sqlite");
  const repository = new BunSqliteSessionRepository({ path });
  const bindings = new BunSqliteRuntimeBindingStore({ path });
  const session = await repository.create({ id: "prompt-recovery" });
  const binding = bindings.put({
    id: "binding:run-prompt-recovery",
    binding: {
      formatVersion: 1,
      agent: { agentSpecId: "assistant", sourceRevision: "abc123" },
      model: { provider: "openai", modelId: "gpt-5" },
      systemPrompt: "Recover prompt entries.",
      tools: [],
    },
  });
  const first = {
    type: "message" as const,
    id: "prompt:first",
    message: { role: "user" as const, content: "first", timestamp: 1 },
  };
  const second = {
    type: "message" as const,
    id: "prompt:second",
    message: { role: "user" as const, content: "second", timestamp: 2 },
  };
  await session.appendRecord({
    type: "operation_started",
    id: "run-prompt-recovery",
    lane: "main",
    sourceLeafId: null,
    intent: {
      kind: "run",
      originalPrompt: [first.message, second.message],
      initialMessages: [first, second],
      resumeData: { "llm-space": { ...binding } },
    },
  });
  await session.appendEntry(first, "main");
  let observed: readonly unknown[] = [];
  const runtime = new DurablePiRuntime({
    repository,
    bindings,
    assistantExecutor: {
      execute(input) {
        observed = input.messages;
        return Promise.resolve(ASSISTANT);
      },
    },
  });
  try {
    const recovered = await runtime.open({ sessionId: "prompt-recovery" });
    expect(recovered.messages).toEqual([first.message]);
    const completed = await runtime.step({
      sessionId: "prompt-recovery",
      expectedActionId: recovered.nextAction!.id,
      kind: "model",
    });
    expect(observed).toEqual([first.message, second.message]);
    expect(completed.messages.slice(0, 2)).toEqual([
      first.message,
      second.message,
    ]);
  } finally {
    bindings.close();
    await repository.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("signals and settles an active provider effect before abort finishes", async () => {
  const root = await mkdtemp(join(tmpdir(), "llm-space-pi-abort-"));
  const path = join(root, "studio.sqlite");
  const repository = new BunSqliteSessionRepository({ path });
  const bindings = new BunSqliteRuntimeBindingStore({ path });
  let releaseStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    releaseStarted = resolve;
  });
  let observedAbort = false;
  const runtime = new DurablePiRuntime({
    repository,
    bindings,
    assistantExecutor: {
      execute({ signal }) {
        releaseStarted();
        return new Promise((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => {
              observedAbort = true;
              reject(new Error("provider aborted"));
            },
            { once: true }
          );
        });
      },
    },
  });
  try {
    await runtime.createSession({ id: "abort" });
    const snapshot = await runtime.start({
      operationId: "run-abort",
      sessionId: "abort",
      messages: [{ role: "user", content: "wait", timestamp: 1 }],
      binding: {
        formatVersion: 1,
        agent: { agentSpecId: "assistant", sourceRevision: "abc123" },
        model: { provider: "openai", modelId: "gpt-5" },
        systemPrompt: "Wait.",
        tools: [],
      },
    });
    const step = runtime
      .step({
        sessionId: "abort",
        expectedActionId: snapshot.nextAction!.id,
        kind: "model",
      })
      .then(
        () => undefined,
        (error: unknown) => error
      );
    await started;
    const aborted = await runtime.abort({ sessionId: "abort" });
    expect(await step).toBeInstanceOf(Error);
    expect(observedAbort).toBe(true);
    expect(aborted.status).toBe("aborted");
    expect((await runtime.open({ sessionId: "abort" })).messages).toEqual([
      { role: "user", content: "wait", timestamp: 1 },
    ]);
  } finally {
    bindings.close();
    await repository.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("runs tool policies around the admitted effect and commits tool usage", async () => {
  const root = await mkdtemp(join(tmpdir(), "llm-space-pi-tool-policy-"));
  const path = join(root, "studio.sqlite");
  const repository = new BunSqliteSessionRepository({ path });
  const bindings = new BunSqliteRuntimeBindingStore({ path });
  let executedWith: unknown;
  const policyTool = defineTool({
    description: "Policy tool",
    inputSchema: {
      type: "object",
      properties: { value: { type: "string" } },
      required: ["value"],
      additionalProperties: false,
    },
    execute(input: { value: string }) {
      executedWith = input;
      return input.value;
    },
  });
  const runtime = new DurablePiRuntime({
    repository,
    bindings,
    assistantExecutor: {
      execute: () =>
        Promise.resolve({
          ...ASSISTANT,
          content: [
            {
              type: "toolCall",
              id: "policy-call",
              name: "policy",
              arguments: { value: "original" },
            },
          ],
          stopReason: "toolUse",
        }),
    },
    resolveTools: () =>
      new Map([
        ["policy", runtimeTool(policyTool, { implementationId: "policy@1" })],
      ]),
    createToolContext: _unusedToolContext,
    toolPolicies: {
      before: () => ({ effectiveArgs: { value: "adjusted" } }),
      after: () => ({
        modelOutput: { type: "text", value: "finalized" },
        details: { finalized: true },
        usage: ASSISTANT.usage,
      }),
    },
  });
  try {
    await runtime.createSession({ id: "tool-policy" });
    let snapshot = await runtime.start({
      operationId: "run-policy",
      sessionId: "tool-policy",
      messages: [{ role: "user", content: "go", timestamp: 1 }],
      binding: {
        formatVersion: 1,
        agent: { agentSpecId: "assistant", sourceRevision: "abc123" },
        model: { provider: "openai", modelId: "gpt-5" },
        systemPrompt: "Use policy.",
        tools: [
          { name: "policy", implementationId: "policy@1", replay: "never" },
        ],
      },
    });
    snapshot = await runtime.step({
      sessionId: "tool-policy",
      expectedActionId: snapshot.nextAction!.id,
      kind: "model",
    });
    snapshot = await runtime.step({
      sessionId: "tool-policy",
      expectedActionId: snapshot.nextAction!.id,
      kind: "tool",
    });
    expect(executedWith).toEqual({ value: "adjusted" });
    expect(snapshot.messages.at(-1)).toMatchObject({
      role: "toolResult",
      content: [{ type: "text", text: "finalized" }],
      details: { finalized: true },
    });
    const check = await repository.open((await repository.list())[0]!);
    const usageRecords = await check.findRecords({
      type: "usage",
      runId: "run-policy",
    });
    expect(usageRecords.some((record) => record.cause === "tool")).toBe(true);
  } finally {
    bindings.close();
    await repository.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("faults a provisioned tool result materialized with the wrong entry role", async () => {
  const root = await mkdtemp(join(tmpdir(), "llm-space-pi-result-corruption-"));
  const path = join(root, "studio.sqlite");
  const repository = new BunSqliteSessionRepository({ path });
  const bindings = new BunSqliteRuntimeBindingStore({ path });
  const session = await repository.create({ id: "result-corruption" });
  const binding = bindings.put({
    id: "binding:run-result-corruption",
    binding: {
      formatVersion: 1,
      agent: { agentSpecId: "assistant", sourceRevision: "abc123" },
      model: { provider: "openai", modelId: "gpt-5" },
      systemPrompt: "Reject conflicting results.",
      tools: [{ name: "echo", implementationId: "echo@1", replay: "never" }],
    },
  });
  await session.appendRecord({
    type: "operation_started",
    id: "run-result-corruption",
    lane: "main",
    sourceLeafId: null,
    intent: {
      kind: "run",
      originalPrompt: [],
      initialMessages: [],
      resumeData: { "llm-space": { ...binding } },
    },
  });
  const assistant = {
    ...ASSISTANT,
    content: [
      {
        type: "toolCall" as const,
        id: "echo-call",
        name: "echo",
        arguments: {},
      },
    ],
    stopReason: "toolUse" as const,
  };
  await session.appendRecord({
    type: "step_attempt",
    id: "result-assistant:attempt:1",
    lane: "main",
    runId: "run-result-corruption",
    step: "assistant",
    attempt: 1,
    resultEntryId: "result-assistant",
  });
  await session.appendEntry(
    { type: "message", id: "result-assistant", message: assistant },
    "main"
  );
  await session.appendRecord({
    type: "tool_started",
    id: "result-assistant:tool:0:started",
    lane: "main",
    runId: "run-result-corruption",
    assistantEntryId: "result-assistant",
    toolIndex: 0,
    toolCallId: "echo-call",
    toolName: "echo",
    effectiveArgs: {},
    resultEntryId: "result-assistant:tool:0:result",
    replay: "never",
  });
  await session.appendEntry(
    {
      type: "message",
      id: "result-assistant:tool:0:result",
      message: {
        role: "user",
        content: "wrong role",
        timestamp: 2,
      },
    },
    "main"
  );
  const runtime = new DurablePiRuntime({
    repository,
    bindings,
    assistantExecutor: { execute: () => Promise.resolve(ASSISTANT) },
  });
  try {
    expect(
      runtime.open({ sessionId: "result-corruption" })
    ).rejects.toBeInstanceOf(DurableSessionCorruptionError);
  } finally {
    bindings.close();
    await repository.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("faults an attempt gap instead of resuming through corrupt records", async () => {
  const root = await mkdtemp(join(tmpdir(), "llm-space-pi-corruption-"));
  const path = join(root, "studio.sqlite");
  const repository = new BunSqliteSessionRepository({ path });
  const bindings = new BunSqliteRuntimeBindingStore({ path });
  const session = await repository.create({ id: "corruption" });
  const binding = bindings.put({
    id: "binding:run-corruption",
    binding: {
      formatVersion: 1,
      agent: { agentSpecId: "assistant", sourceRevision: "abc123" },
      model: { provider: "openai", modelId: "gpt-5" },
      systemPrompt: "Fail closed.",
      tools: [],
    },
  });
  await session.appendRecord({
    type: "operation_started",
    id: "run-corruption",
    lane: "main",
    sourceLeafId: null,
    intent: {
      kind: "run",
      originalPrompt: [],
      initialMessages: [],
      resumeData: { "llm-space": { ...binding } },
    },
  });
  await session.appendRecord({
    type: "step_attempt",
    id: "corrupt-result:attempt:2",
    lane: "main",
    runId: "run-corruption",
    step: "assistant",
    attempt: 2,
    resultEntryId: "corrupt-result",
  });
  const runtime = new DurablePiRuntime({
    repository,
    bindings,
    assistantExecutor: { execute: () => Promise.resolve(ASSISTANT) },
  });
  try {
    expect(runtime.open({ sessionId: "corruption" })).rejects.toBeInstanceOf(
      DurableSessionCorruptionError
    );
  } finally {
    bindings.close();
    await repository.close();
    await rm(root, { recursive: true, force: true });
  }
});

function _unusedToolContext(input: {
  readonly execution: ToolContext["execution"];
  readonly signal: AbortSignal;
}): ToolContext {
  return {
    execution: input.execution,
    abortSignal: input.signal,
    getSandbox: () => Promise.reject(new Error("unused")),
    getSkill: () => {
      throw new Error("unused");
    },
    getToken: () => Promise.reject(new Error("unused")),
    requireAuth: () => {
      throw new Error("unused");
    },
  };
}
