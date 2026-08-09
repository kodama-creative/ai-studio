import { describe, expect, test } from "bun:test";

import type { LoadAgentResult } from "@llm-space/agent/loader";

import {
  InMemorySessionEventLog,
  InMemorySessionRepository,
  createHarness,
  type HarnessEvent,
  type ModelTurnEngine,
  type ModelTurnEvent,
  type ModelTurnInput,
} from "./index";

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

describe("Harness", () => {
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
      "step.started",
      "message.appended",
      "message.appended",
      "message.completed",
      "step.completed",
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
    const generation = _generation();
    const firstHarness = createHarness({
      engine: new ScriptedModelEngine([]),
      repository,
      eventLog,
    });
    const firstAgent = await firstHarness.prepare(generation);
    const original = await firstAgent.createSession();
    await repository.save({
      ...(await original.snapshot()),
      activeTurnId: "turn-stale",
      status: "running",
    });
    const nextHarness = createHarness({
      engine: new ScriptedModelEngine([]),
      repository,
      eventLog,
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
    const harness = createHarness({ engine, eventLog });
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
      "step.started",
      "message.appended",
      "step.failed",
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
      "step.started",
      "message.appended",
      "message.completed",
      "step.completed",
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
    const harness = createHarness({ engine, eventLog });
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
      "step.started",
      "message.appended",
      "turn.cancelled",
      "session.waiting",
    ]);
  });
});
