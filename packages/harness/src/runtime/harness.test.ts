import { describe, expect, test } from "bun:test";

import type { LoadAgentResult } from "@llm-space/agent/loader";
import type { ToolContext } from "@llm-space/agent/tools";

import {
  InMemorySessionEventLog,
  InMemorySessionCommandQueue,
  InMemorySessionRepository,
  InMemoryRunRepository,
  createHarness,
  type HarnessEvent,
  type ModelTurnEngine,
  type ModelTurnEvent,
  type ModelTurnInput,
} from "../index";

function _generation(
  input: {
    readonly instructions?: string;
    readonly tool?: Readonly<Record<string, unknown>>;
  } = {}
): LoadAgentResult {
  const tool = input.tool;
  return {
    diagnostics: [],
    manifest: {
      kind: "llm-space-agent-manifest",
      agentId: "fixture-agent",
      agent: { model: "fixture/model" },
      channels: [],
      connections: [],
      extensions: [],
      hooks: [],
      instructions: [
        {
          logicalPath: "instructions.md",
          markdown: input.instructions ?? "Be useful.",
          sourceId: "instructions.md",
          sourceKind: "markdown",
        },
      ],
      schedules: [],
      skills: [],
      sandboxWorkspace: [],
      subagents: [],
      tools:
        tool === undefined
          ? []
          : [
              {
                description: String(tool.description),
                inputSchema: tool.inputSchema as Readonly<
                  Record<string, unknown>
                >,
                logicalPath: "tools/echo.ts",
                name: "echo",
                sourceId: "tools/echo.ts",
                sourceKind: "module",
              },
            ],
    },
    moduleMap: {
      nodes: {
        $root: {
          modules:
            tool === undefined ? {} : { "tools/echo.ts": { default: tool } },
        },
      },
    },
    project: {
      agentRoot: "/fixture/agent",
      appRoot: "/fixture",
      layout: "nested",
    },
    sourceFingerprint: "fixture-generation",
  };
}

class ScriptedModelEngine implements ModelTurnEngine {
  readonly inputs: ModelTurnInput[] = [];

  constructor(private readonly _turns: readonly ModelTurnEvent[][]) {}

  async *run(input: ModelTurnInput): AsyncIterable<ModelTurnEvent> {
    await Promise.resolve();
    this.inputs.push(input);
    const turn = this._turns[this.inputs.length - 1];
    if (turn === undefined) throw new Error("No scripted model turn remains.");
    for (const event of turn) yield event;
  }
}

async function _events(
  log: InMemorySessionEventLog,
  sessionId: string
): Promise<HarnessEvent[]> {
  const events: HarnessEvent[] = [];
  for await (const event of log.read(sessionId)) events.push(event);
  return events;
}

async function _waitForTurn(
  session: {
    events(cursor?: {
      readonly afterSequence?: number;
      readonly follow?: boolean;
    }): AsyncIterable<HarnessEvent>;
  },
  turnId: string,
  afterSequence = 0
): Promise<HarnessEvent> {
  for await (const event of session.events({
    afterSequence,
    follow: true,
  })) {
    if (
      (event.event.type === "turn.completed" ||
        event.event.type === "turn.cancelled" ||
        event.event.type === "turn.failed") &&
      event.event.turnId === turnId
    ) {
      return event;
    }
  }
  throw new Error(`Turn "${turnId}" ended without a terminal event.`);
}

describe("Harness", () => {
  test("persists a Session turn as an independent Run resource", async () => {
    const runRepository = new InMemoryRunRepository();
    const harness = createHarness({
      engine: new ScriptedModelEngine([
        [
          { type: "text.delta", delta: "Done" },
          { type: "finish", reason: "stop" },
        ],
      ]),
      runRepository,
      clock: () => 42,
      generateId: (() => {
        const ids = ["session-1", "command-1", "turn-1", "message-1", "message-2"];
        return () => ids.shift()!;
      })(),
    });
    const agent = await harness.prepare(_generation());
    const session = await agent.createSession();

    const receipt = await session.submit({ message: "Run" });
    await _waitForTurn(session, receipt.turnId, receipt.afterSequence);

    expect(await runRepository.load(receipt.turnId)).toEqual({
      schemaVersion: 1,
      id: receipt.turnId,
      owner: { type: "session", sessionId: session.id },
      triggerMessageId: "message-1",
      status: "completed",
      createdAt: 42,
      startedAt: 42,
      completedAt: 42,
    });
  });

  test("accepts a command before its turn completes", async () => {
    let release: (() => void) | undefined;
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const engine: ModelTurnEngine = {
      async *run() {
        markStarted?.();
        await gate;
        yield { type: "text.delta", delta: "Accepted" } as const;
        yield { type: "finish", reason: "stop" } as const;
      },
    };
    const eventLog = new InMemorySessionEventLog();
    const runRepository = new InMemoryRunRepository();
    const harness = createHarness({ engine, eventLog, runRepository });
    const agent = await harness.prepare(_generation());
    const session = await agent.createSession();

    const receipt = await session.submit({ message: "Run later" });
    await started;

    expect(receipt.sessionId).toBe(session.id);
    expect(typeof receipt.commandId).toBe("string");
    expect(typeof receipt.turnId).toBe("string");
    expect(typeof receipt.acceptedAt).toBe("number");
    expect(await session.snapshot()).toMatchObject({ status: "running" });

    const completed = _waitForTurn(
      session,
      receipt.turnId,
      receipt.afterSequence
    );
    expect(release).toBeFunction();
    release!();
    expect((await completed).event.type).toBe("turn.completed");
  });

  test("serially consumes multiple commands submitted to one session", async () => {
    let releaseFirst: (() => void) | undefined;
    let markFirstStarted: (() => void) | undefined;
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const inputs: ModelTurnInput[] = [];
    let activeRuns = 0;
    let maxActiveRuns = 0;
    const engine: ModelTurnEngine = {
      async *run(input) {
        inputs.push(input);
        activeRuns += 1;
        maxActiveRuns = Math.max(maxActiveRuns, activeRuns);
        try {
          if (inputs.length === 1) {
            markFirstStarted?.();
            await firstGate;
          }
          yield {
            type: "text.delta",
            delta: `reply-${inputs.length}`,
          } as const;
          yield { type: "finish", reason: "stop" } as const;
        } finally {
          activeRuns -= 1;
        }
      },
    };
    const harness = createHarness({ engine });
    const agent = await harness.prepare(_generation());
    const session = await agent.createSession();

    const first = await session.submit({ message: "first" });
    await firstStarted;
    const second = await session.submit({ message: "second" });
    releaseFirst?.();
    await _waitForTurn(session, second.turnId);

    expect(first.commandId).not.toBe(second.commandId);
    expect(maxActiveRuns).toBe(1);
    expect(
      inputs.map((input) =>
        input.messages
          .filter((message) => message.role === "user")
          .map((message) => message.content)
      )
    ).toEqual([["first"], ["first", "second"]]);
  });

  test("keeps one active command across two Harness instances", async () => {
    let releaseFirst: (() => void) | undefined;
    let markFirstStarted: (() => void) | undefined;
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let activeRuns = 0;
    let maxActiveRuns = 0;
    const inputs: ModelTurnInput[] = [];
    const engine: ModelTurnEngine = {
      async *run(input) {
        inputs.push(input);
        activeRuns += 1;
        maxActiveRuns = Math.max(maxActiveRuns, activeRuns);
        try {
          if (inputs.length === 1) {
            markFirstStarted?.();
            await firstGate;
          }
          yield { type: "text.delta", delta: "done" } as const;
          yield { type: "finish", reason: "stop" } as const;
        } finally {
          activeRuns -= 1;
        }
      },
    };
    const repository = new InMemorySessionRepository();
    const eventLog = new InMemorySessionEventLog();
    const commandQueue = new InMemorySessionCommandQueue();
    const generation = _generation();
    const firstHarness = createHarness({
      engine,
      repository,
      eventLog,
      commandQueue,
    });
    const firstAgent = await firstHarness.prepare(generation);
    const firstSession = await firstAgent.createSession();
    const first = await firstSession.submit({ message: "first" });
    await firstStarted;
    const secondHarness = createHarness({
      engine,
      repository,
      eventLog,
      commandQueue,
    });
    const secondAgent = await secondHarness.prepare(generation);
    const secondSession = await secondAgent.attachSession(firstSession.id);
    if (secondSession === undefined) throw new Error("Expected Session.");

    const second = await secondSession.submit({ message: "second" });
    releaseFirst?.();
    await _waitForTurn(firstSession, second.turnId);

    expect(first.turnId).not.toBe(second.turnId);
    expect(maxActiveRuns).toBe(1);
    expect(inputs).toHaveLength(2);
  });

  test("reloads durable history before a stale attached worker executes", async () => {
    const repository = new InMemorySessionRepository();
    const eventLog = new InMemorySessionEventLog();
    const commandQueue = new InMemorySessionCommandQueue();
    const generation = _generation();
    const firstEngine = new ScriptedModelEngine([
      [
        { type: "text.delta", delta: "first reply" },
        { type: "finish", reason: "stop" },
      ],
    ]);
    const firstHarness = createHarness({
      engine: firstEngine,
      repository,
      eventLog,
      commandQueue,
    });
    const firstAgent = await firstHarness.prepare(generation);
    const firstSession = await firstAgent.createSession();
    const secondEngine = new ScriptedModelEngine([
      [
        { type: "text.delta", delta: "second reply" },
        { type: "finish", reason: "stop" },
      ],
    ]);
    const secondHarness = createHarness({
      engine: secondEngine,
      repository,
      eventLog,
      commandQueue,
    });
    const secondAgent = await secondHarness.prepare(generation);
    const staleSession = await secondAgent.attachSession(firstSession.id);
    if (staleSession === undefined) throw new Error("Expected Session.");

    await firstSession.send({ message: "first" });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await staleSession.send({ message: "second" });

    expect(
      secondEngine.inputs[0]?.messages
        .filter((message) => message.role === "user")
        .map((message) => message.content)
    ).toEqual(["first", "second"]);
  });

  test("fences stale in-memory command leases after recovery", async () => {
    const queue = new InMemorySessionCommandQueue();
    const sessionId = "session-fencing";
    await queue.enqueue({
      id: "command-fencing",
      sessionId,
      turnId: "turn-fencing",
      message: "run once",
      principal: null,
      createdAt: 10,
    });
    const stale = await queue.claim(sessionId, {
      now: 0,
      leaseExpiresAt: 1,
    });
    const current = (
      await queue.recover(sessionId, {
        now: 2,
        leaseExpiresAt: 100,
      })
    ).recovered[0];
    expect(current?.command.id).toBe("command-fencing");

    await stale?.complete();
    await stale?.release();
    expect(stale?.renew(200)).rejects.toThrow("no longer active");
    expect(
      (
        await queue.recover(sessionId, {
          now: 2,
          leaseExpiresAt: 100,
        })
      ).active[0]?.command.id
    ).toBe("command-fencing");
    await current?.complete();
    expect(
      await queue.claim(sessionId, { now: 2, leaseExpiresAt: 100 })
    ).toBeUndefined();
  });

  test("deduplicates completed channel deliveries without replaying execution", async () => {
    const engine = new ScriptedModelEngine([
      [
        { type: "text.delta", delta: "Once" },
        { type: "finish", reason: "stop" },
      ],
    ]);
    const harness = createHarness({ engine });
    const agent = await harness.prepare(_generation());
    const session = await agent.createSession();
    const input = {
      message: "Deliver once",
      source: {
        channelId: "http",
        address: "tenant-1/conversation-1",
        deliveryId: "request-1",
      },
    };

    const first = await session.submit(input);
    await _waitForTurn(session, first.turnId, first.afterSequence);
    const duplicate = await session.submit(input);
    await session.send(input);
    let mismatch: unknown;
    try {
      await session.submit({ ...input, message: "changed payload" });
    } catch (error) {
      mismatch = error;
    }

    expect(first.deduplicated).toBe(false);
    expect(duplicate).toMatchObject({
      commandId: first.commandId,
      turnId: first.turnId,
      acceptedAt: first.acceptedAt,
      deduplicated: true,
      afterSequence: 0,
    });
    expect(engine.inputs).toHaveLength(1);
    expect(mismatch).toBeInstanceOf(Error);
    expect((mismatch as Error).message).toContain("different payload");
  });

  test("prepares an agent generation and runs a conversation turn", async () => {
    const engine = new ScriptedModelEngine([
      [
        { type: "text.delta", delta: "Hello" },
        { type: "text.delta", delta: " there" },
        { type: "finish", reason: "stop" },
      ],
    ]);
    const repository = new InMemorySessionRepository();
    const eventLog = new InMemorySessionEventLog();
    const harness = createHarness({ engine, eventLog, repository });
    const agent = await harness.prepare(
      _generation({ instructions: "Answer briefly." })
    );
    const session = await agent.createSession();

    await session.send({ message: "Hi" });

    expect(engine.inputs).toHaveLength(1);
    expect(engine.inputs[0]).toMatchObject({
      agentId: "fixture-agent",
      instructions: ["Answer briefly."],
      model: "fixture/model",
      messages: [{ role: "user", content: "Hi" }],
      tools: [],
    });
    expect(await session.snapshot()).toMatchObject({
      status: "waiting",
      messages: [
        { role: "user", content: "Hi" },
        { role: "assistant", content: "Hello there", toolCalls: [] },
      ],
    });
    expect(
      (await _events(eventLog, session.id)).map((item) => item.event.type)
    ).toEqual([
      "session.started",
      "turn.started",
      "message.received",
      "message.appended",
      "message.appended",
      "message.completed",
      "turn.completed",
      "session.waiting",
    ]);
  });

  test("executes authored tools between model steps", async () => {
    const calls: unknown[] = [];
    const engine = new ScriptedModelEngine([
      [
        {
          type: "tool.call",
          call: { id: "call-1", name: "echo", input: { value: "hello" } },
        },
        { type: "finish", reason: "tool-calls" },
      ],
      [
        { type: "text.delta", delta: "HELLO" },
        { type: "finish", reason: "stop" },
      ],
    ]);
    const eventLog = new InMemorySessionEventLog();
    const harness = createHarness({ engine, eventLog });
    const agent = await harness.prepare(
      _generation({
        tool: {
          description: "Echo text",
          inputSchema: { type: "object" },
          execute(input: unknown) {
            calls.push(input);
            return "hello";
          },
          toModelOutput(output: unknown) {
            return { type: "text", value: String(output).toUpperCase() };
          },
        },
      })
    );
    const session = await agent.createSession();

    await session.send({ message: "Echo it" });

    expect(calls).toEqual([{ value: "hello" }]);
    expect(engine.inputs).toHaveLength(2);
    expect(engine.inputs[1]?.messages.at(-1)).toMatchObject({
      role: "tool",
      callId: "call-1",
      name: "echo",
      output: { type: "text", value: "HELLO" },
      isError: false,
    });
    expect(engine.inputs[1]?.messages.at(-1)?.id).toBeString();
    expect((await session.snapshot()).messages.at(-1)).toMatchObject({
      role: "assistant",
      content: "HELLO",
    });
    expect(
      (await _events(eventLog, session.id)).map((item) => item.event.type)
    ).toContain("action.result");
  });

  test("propagates the initiating and current principals into tool execution", async () => {
    let toolContext: ToolContext | undefined;
    const engine = new ScriptedModelEngine([
      [
        {
          type: "tool.call",
          call: { id: "identity-call", name: "echo", input: {} },
        },
        { type: "finish", reason: "tool-calls" },
      ],
      [
        { type: "text.delta", delta: "Done" },
        { type: "finish", reason: "stop" },
      ],
    ]);
    const harness = createHarness({ engine });
    const agent = await harness.prepare(
      _generation({
        tool: {
          description: "Capture identity",
          inputSchema: { type: "object" },
          execute(_input: unknown, context: ToolContext) {
            toolContext = context;
            return "captured";
          },
        },
      })
    );
    const initiator = {
      attributes: { tenant: "tenant-1" },
      authenticator: "fixture",
      principalId: "user-1",
      principalType: "user",
    };
    const current = {
      attributes: { tenant: "tenant-1" },
      authenticator: "fixture",
      principalId: "user-2",
      principalType: "user",
    };
    const session = await agent.createSession({ initiator });

    await session.send({ message: "Run", principal: current });

    expect(toolContext?.session.auth).toEqual({ current, initiator });
    expect((await session.snapshot()).auth).toEqual({ initiator });
  });

  test("fails closed for authored semantics that are not implemented yet", async () => {
    const harness = createHarness({ engine: new ScriptedModelEngine([]) });
    const generation = _generation({
      tool: {
        description: "Dangerous tool",
        inputSchema: { type: "object" },
        approval: () => "user-approval",
        execute() {
          return undefined;
        },
      },
    });

    let failure: unknown;
    try {
      await harness.prepare(generation);
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain(
      'Tool approval for "echo" is not supported'
    );

    const workspaceBase = _generation();
    const workspaceGeneration: LoadAgentResult = {
      ...workspaceBase,
      manifest: {
        ...workspaceBase.manifest,
        sandboxWorkspace: [
          {
            logicalPath: "workspace/seed.txt",
            sourceId: "workspace/seed.txt",
            sourceKind: "workspace",
          },
        ],
      },
    };
    try {
      await harness.prepare(workspaceGeneration);
    } catch (error) {
      failure = error;
    }
    expect((failure as Error).message).toContain("sandbox workspace");
  });

  test("preserves an executable static model handle from the generation", async () => {
    const modelHandle = { specificationVersion: "v3", modelId: "fixture" };
    const base = _generation();
    const generation: LoadAgentResult = {
      ...base,
      manifest: {
        ...base.manifest,
        agentSource: {
          logicalPath: "agent.ts",
          sourceId: "agent.ts",
          sourceKind: "module",
        },
      },
      moduleMap: {
        nodes: {
          ...base.moduleMap.nodes,
          $root: {
            modules: {
              ...base.moduleMap.nodes.$root.modules,
              "agent.ts": { default: { model: modelHandle } },
            },
          },
        },
      },
    };
    const engine = new ScriptedModelEngine([
      [
        { type: "text.delta", delta: "Done" },
        { type: "finish", reason: "stop" },
      ],
    ]);
    const harness = createHarness({ engine });
    const agent = await harness.prepare(generation);
    const session = await agent.createSession();

    await session.send({ message: "Run" });

    expect(engine.inputs[0]?.model as unknown).toBe(modelHandle);
  });

  test("validates tool input before executing authored side effects", async () => {
    let executions = 0;
    const engine = new ScriptedModelEngine([
      [
        {
          type: "tool.call",
          call: { id: "invalid-call", name: "echo", input: {} },
        },
        { type: "finish", reason: "tool-calls" },
      ],
      [
        { type: "text.delta", delta: "Handled" },
        { type: "finish", reason: "stop" },
      ],
    ]);
    const harness = createHarness({ engine });
    const agent = await harness.prepare(
      _generation({
        tool: {
          description: "Echo text",
          inputSchema: {
            type: "object",
            required: ["value"],
            properties: { value: { type: "string" } },
          },
          execute() {
            executions += 1;
          },
        },
      })
    );
    const session = await agent.createSession();

    await session.send({ message: "Run" });

    expect(executions).toBe(0);
    const toolMessage = engine.inputs[1]?.messages.at(-1);
    expect(toolMessage).toMatchObject({
      role: "tool",
      isError: true,
      output: {
        type: "text",
      },
    });
    expect(
      toolMessage?.role === "tool" && toolMessage.output.type === "text"
        ? toolMessage.output.value
        : ""
    ).toContain("failed validation");
  });

  test("reattaches a persisted session through the same prepared agent", async () => {
    const repository = new InMemorySessionRepository();
    const harness = createHarness({
      engine: new ScriptedModelEngine([
        [
          { type: "text.delta", delta: "Done" },
          { type: "finish", reason: "stop" },
        ],
      ]),
      repository,
    });
    const agent = await harness.prepare(_generation());
    const session = await agent.createSession();
    await session.send({ message: "Run" });

    const attached = await agent.attachSession(session.id);

    expect(attached).not.toBeUndefined();
    expect(await attached?.snapshot()).toEqual(await session.snapshot());
  });

  test("recovers cancellation for a reattached running snapshot", async () => {
    const repository = new InMemorySessionRepository();
    const eventLog = new InMemorySessionEventLog();
    const commandQueue = new InMemorySessionCommandQueue();
    const generation = _generation();
    const firstHarness = createHarness({
      engine: new ScriptedModelEngine([]),
      repository,
      eventLog,
      commandQueue,
    });
    const firstAgent = await firstHarness.prepare(generation);
    const original = await firstAgent.createSession();
    await repository.save({
      ...(await original.snapshot()),
      activeTurnId: "turn-stale",
      status: "running",
    });
    await commandQueue.enqueue({
      id: "command-stale",
      sessionId: original.id,
      turnId: "turn-stale",
      message: "Do not replay",
      principal: null,
      createdAt: 10,
    });
    await commandQueue.claim(original.id, { now: 0, leaseExpiresAt: 0 });
    const nextHarness = createHarness({
      engine: new ScriptedModelEngine([]),
      repository,
      eventLog,
      commandQueue,
    });
    const nextAgent = await nextHarness.prepare(generation);
    const attached = await nextAgent.attachSession(original.id);

    await attached?.cancel();

    expect(await attached?.snapshot()).toMatchObject({
      activeTurnId: undefined,
      status: "waiting",
    });
    expect(
      (await _events(eventLog, original.id)).map((item) => item.event.type)
    ).toEqual(["session.started", "turn.cancelled", "session.waiting"]);
    expect(
      await commandQueue.claim(original.id, {
        now: Date.now(),
        leaseExpiresAt: Date.now() + 30_000,
      })
    ).toBeUndefined();
  });

  test("continues pending commands after cancelling an interrupted turn", async () => {
    const repository = new InMemorySessionRepository();
    const eventLog = new InMemorySessionEventLog();
    const commandQueue = new InMemorySessionCommandQueue();
    const generation = _generation();
    const firstHarness = createHarness({
      engine: new ScriptedModelEngine([]),
      repository,
      eventLog,
      commandQueue,
    });
    const firstAgent = await firstHarness.prepare(generation);
    const original = await firstAgent.createSession();
    await repository.save({
      ...(await original.snapshot()),
      activeTurnId: "turn-interrupted",
      status: "running",
    });
    await commandQueue.enqueue({
      id: "command-interrupted",
      sessionId: original.id,
      turnId: "turn-interrupted",
      message: "interrupted",
      principal: null,
      createdAt: 10,
    });
    await commandQueue.claim(original.id, { now: 0, leaseExpiresAt: 0 });
    await commandQueue.enqueue({
      id: "command-pending",
      sessionId: original.id,
      turnId: "turn-pending",
      message: "continue",
      principal: null,
      createdAt: 20,
    });
    const nextHarness = createHarness({
      engine: new ScriptedModelEngine([
        [
          { type: "text.delta", delta: "continued" },
          { type: "finish", reason: "stop" },
        ],
      ]),
      repository,
      eventLog,
      commandQueue,
    });
    const nextAgent = await nextHarness.prepare(generation);

    const attached = await nextAgent.attachSession(original.id);
    if (attached === undefined) throw new Error("Expected restored Session.");
    await _waitForTurn(attached, "turn-pending");

    expect(await attached.snapshot()).toMatchObject({
      status: "waiting",
      messages: [
        { role: "user", content: "continue" },
        { role: "assistant", content: "continued" },
      ],
    });
    expect(
      (await _events(eventLog, original.id)).map((item) => item.event.type)
    ).toContain("turn.cancelled");
  });

  test("retries recovery when a lease observed in another worker expires", async () => {
    const repository = new InMemorySessionRepository();
    const eventLog = new InMemorySessionEventLog();
    const commandQueue = new InMemorySessionCommandQueue();
    const generation = _generation();
    const firstHarness = createHarness({
      engine: new ScriptedModelEngine([]),
      repository,
      eventLog,
      commandQueue,
    });
    const firstAgent = await firstHarness.prepare(generation);
    const original = await firstAgent.createSession();
    await repository.save({
      ...(await original.snapshot()),
      activeCommandId: "command-leased",
      activeTurnId: "turn-leased",
      status: "running",
    });
    await commandQueue.enqueue({
      id: "command-leased",
      sessionId: original.id,
      turnId: "turn-leased",
      message: "owned by a crashed worker",
      principal: null,
      createdAt: 10,
    });
    const now = Date.now();
    await commandQueue.claim(original.id, {
      now,
      leaseExpiresAt: now + 20,
    });
    const nextHarness = createHarness({
      engine: new ScriptedModelEngine([]),
      repository,
      eventLog,
      commandQueue,
      commandLeaseDurationMs: 10,
    });
    const nextAgent = await nextHarness.prepare(generation);

    const attached = await nextAgent.attachSession(original.id);
    if (attached === undefined) throw new Error("Expected restored Session.");
    const terminal = await _waitForTurn(attached, "turn-leased");

    expect(terminal.event.type).toBe("turn.cancelled");
    expect(await attached.snapshot()).toMatchObject({
      activeCommandId: undefined,
      activeTurnId: undefined,
      status: "waiting",
    });
  });

  test("reconciles a persisted terminal event without emitting cancellation", async () => {
    const repository = new InMemorySessionRepository();
    const eventLog = new InMemorySessionEventLog();
    const commandQueue = new InMemorySessionCommandQueue();
    const generation = _generation();
    const firstHarness = createHarness({
      engine: new ScriptedModelEngine([]),
      repository,
      eventLog,
      commandQueue,
    });
    const firstAgent = await firstHarness.prepare(generation);
    const original = await firstAgent.createSession();
    const initial = await original.snapshot();
    const terminalSequence = initial.eventSequence + 1;
    await repository.save({
      ...initial,
      activeCommandId: "command-completed",
      activeTurnId: "turn-completed",
      eventSequence: terminalSequence,
      status: "running",
    });
    await eventLog.append({
      sessionId: original.id,
      sequence: terminalSequence,
      timestamp: 20,
      event: { type: "turn.completed", turnId: "turn-completed" },
    });
    await commandQueue.enqueue({
      id: "command-completed",
      sessionId: original.id,
      turnId: "turn-completed",
      message: "already completed",
      principal: null,
      createdAt: 10,
    });
    await commandQueue.claim(original.id, { now: 0, leaseExpiresAt: 0 });
    const nextEngine = new ScriptedModelEngine([]);
    const nextHarness = createHarness({
      engine: nextEngine,
      repository,
      eventLog,
      commandQueue,
    });
    const nextAgent = await nextHarness.prepare(generation);

    const attached = await nextAgent.attachSession(original.id);
    const events = await _events(eventLog, original.id);

    expect(await attached?.snapshot()).toMatchObject({
      activeCommandId: undefined,
      activeTurnId: undefined,
      status: "waiting",
      lastCommand: {
        commandId: "command-completed",
        turnId: "turn-completed",
        status: "completed",
      },
    });
    expect(nextEngine.inputs).toHaveLength(0);
    expect(
      events.filter((item) => item.event.type === "turn.completed")
    ).toHaveLength(1);
    expect(events.some((item) => item.event.type === "turn.cancelled")).toBe(
      false
    );
  });

  test("does not replay a terminal command recovered before mailbox ack", async () => {
    const repository = new InMemorySessionRepository();
    const eventLog = new InMemorySessionEventLog();
    const commandQueue = new InMemorySessionCommandQueue();
    const generation = _generation();
    const firstHarness = createHarness({
      engine: new ScriptedModelEngine([]),
      repository,
      eventLog,
      commandQueue,
    });
    const firstAgent = await firstHarness.prepare(generation);
    const original = await firstAgent.createSession();
    const enqueue = await commandQueue.enqueue({
      id: "command-terminal",
      sessionId: original.id,
      turnId: "turn-terminal",
      message: "already done",
      principal: null,
      createdAt: 10,
    });
    await commandQueue.claim(original.id, { now: 0, leaseExpiresAt: 0 });
    await repository.save({
      ...(await original.snapshot()),
      status: "waiting",
      lastCommand: {
        commandId: enqueue.command.id,
        turnId: enqueue.command.turnId,
        status: "completed",
      },
    });
    const nextEngine = new ScriptedModelEngine([]);
    const nextHarness = createHarness({
      engine: nextEngine,
      repository,
      eventLog,
      commandQueue,
    });
    const nextAgent = await nextHarness.prepare(generation);

    await nextAgent.attachSession(original.id);
    await Promise.resolve();

    expect(nextEngine.inputs).toHaveLength(0);
    expect(
      (await _events(eventLog, original.id))
        .map((item) => item.event.type)
        .slice(-2)
    ).toEqual(["turn.completed", "session.waiting"]);
    expect(
      await commandQueue.claim(original.id, {
        now: Date.now(),
        leaseExpiresAt: Date.now() + 30_000,
      })
    ).toBeUndefined();
  });

  test("marks the session failed when the model engine throws", async () => {
    const engine: ModelTurnEngine = {
      async *run() {
        await Promise.resolve();
        yield { type: "text.delta", delta: "Partial" } as const;
        throw new Error("provider unavailable");
      },
    };
    const eventLog = new InMemorySessionEventLog();
    const runRepository = new InMemoryRunRepository();
    const harness = createHarness({ engine, eventLog, runRepository });
    const agent = await harness.prepare(_generation());
    const session = await agent.createSession();

    let failure: unknown;
    try {
      await session.send({ message: "Run" });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe("provider unavailable");

    expect(await session.snapshot()).toMatchObject({
      status: "failed",
      error: "provider unavailable",
    });
    expect((await _events(eventLog, session.id)).at(-1)?.event).toEqual({
      type: "session.failed",
      message: "provider unavailable",
    });
    expect(
      await runRepository.listByOwner({ type: "session", sessionId: session.id })
    ).toMatchObject([
      { status: "failed", error: { message: "provider unavailable" } },
    ]);
  });

  test("fails a model step that ends with a non-terminal finish reason", async () => {
    const eventLog = new InMemorySessionEventLog();
    const harness = createHarness({
      engine: new ScriptedModelEngine([
        [
          { type: "text.delta", delta: "Truncated" },
          { type: "finish", reason: "length" },
        ],
      ]),
      eventLog,
    });
    const agent = await harness.prepare(_generation());
    const session = await agent.createSession();

    try {
      await session.send({ message: "Run" });
    } catch {
      // The lifecycle assertions below are the contract under test.
    }

    expect(
      (await _events(eventLog, session.id)).map((item) => item.event.type)
    ).toEqual([
      "session.started",
      "turn.started",
      "message.received",
      "message.appended",
      "turn.failed",
      "session.failed",
    ]);
  });

  test("streams newly appended events to a following consumer", async () => {
    const eventLog = new InMemorySessionEventLog();
    const harness = createHarness({
      engine: new ScriptedModelEngine([
        [
          { type: "text.delta", delta: "Live" },
          { type: "finish", reason: "stop" },
        ],
      ]),
      eventLog,
    });
    const agent = await harness.prepare(_generation());
    const session = await agent.createSession();
    const received: HarnessEvent[] = [];
    const consume = (async () => {
      for await (const event of session.events({ follow: true })) {
        received.push(event);
        if (event.event.type === "session.waiting") break;
      }
    })();

    await session.send({ message: "Run" });
    await consume;

    expect(received.map((item) => item.event.type)).toEqual([
      "session.started",
      "turn.started",
      "message.received",
      "message.appended",
      "message.completed",
      "turn.completed",
      "session.waiting",
    ]);
    const afterTurnStart: HarnessEvent[] = [];
    for await (const event of session.events({
      afterSequence: received[1]!.sequence,
    })) {
      afterTurnStart.push(event);
    }
    expect(afterTurnStart[0]?.event.type).toBe("message.received");
  });

  test("cancels an active turn and returns the session to waiting", async () => {
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const engine: ModelTurnEngine = {
      async *run(_input, { signal }) {
        yield { type: "text.delta", delta: "Partial" };
        markStarted?.();
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () =>
              reject(
                signal.reason instanceof Error
                  ? signal.reason
                  : new Error("Turn aborted.")
              ),
            { once: true }
          );
        });
      },
    };
    const eventLog = new InMemorySessionEventLog();
    const runRepository = new InMemoryRunRepository();
    const harness = createHarness({ engine, eventLog, runRepository });
    const agent = await harness.prepare(_generation());
    const session = await agent.createSession();
    const run = session.send({ message: "Run" });
    await started;

    await session.cancel();
    await run;

    expect(await session.snapshot()).toMatchObject({ status: "waiting" });
    expect(
      (await _events(eventLog, session.id)).map((item) => item.event.type)
    ).toEqual([
      "session.started",
      "turn.started",
      "message.received",
      "message.appended",
      "turn.cancelled",
      "session.waiting",
    ]);
    expect(
      await runRepository.listByOwner({ type: "session", sessionId: session.id })
    ).toMatchObject([{ status: "cancelled" }]);
  });
});
