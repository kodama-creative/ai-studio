import { describe, expect, test } from "bun:test";

import type { LoadAgentResult } from "@llm-space/agent/loader";

import type {
  AgentSession,
  ModelTurnEngine,
  ModelTurnEvent,
  ModelTurnInput,
} from "../index";
import { createHarness } from "../runtime/harness";

import { ChannelAccessDeniedError } from "./channel-access-denied-error";
import { createChannelRuntime } from "./channel-runtime";
import { InMemoryChannelBindingRepository } from "./in-memory-channel-binding-repository";

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

describe("ChannelRuntime", () => {
  test("binds an address once and asynchronously submits idempotent deliveries", async () => {
    const engine = new ScriptedModelEngine([
      [
        { type: "text.delta", delta: "first" },
        { type: "finish", reason: "stop" },
      ],
      [
        { type: "text.delta", delta: "second" },
        { type: "finish", reason: "stop" },
      ],
    ]);
    const harness = createHarness({ engine });
    const agent = await harness.prepare(_generation());
    const bindings = new InMemoryChannelBindingRepository();
    const channel = createChannelRuntime({
      agent,
      bindings,
      accessPolicy: { authorize: () => true },
    });
    const envelope = {
      channelId: "web-chat",
      address: "tenant-1/conversation-1",
      deliveryId: "delivery-1",
      message: "hello",
      principal: null,
    };

    const first = await channel.receive(envelope);
    const session = await agent.attachSession(first.sessionId);
    if (session === undefined) throw new Error("Expected bound Session.");
    await _waitForTurn(session, first.turnId, first.afterSequence);
    const duplicate = await channel.receive(envelope);
    const second = await channel.receive({
      ...envelope,
      deliveryId: "delivery-2",
      message: "again",
    });
    await _waitForTurn(session, second.turnId, second.afterSequence);

    expect(first.bindingCreated).toBe(true);
    expect(duplicate).toMatchObject({
      sessionId: first.sessionId,
      commandId: first.commandId,
      turnId: first.turnId,
      deduplicated: true,
      bindingCreated: false,
    });
    expect(second).toMatchObject({
      sessionId: first.sessionId,
      deduplicated: false,
      bindingCreated: false,
    });
    expect(engine.inputs).toHaveLength(2);
  });

  test("fails closed before creating a binding when access is denied", async () => {
    const harness = createHarness({ engine: new ScriptedModelEngine([]) });
    const agent = await harness.prepare(_generation());
    const bindings = new InMemoryChannelBindingRepository();
    const channel = createChannelRuntime({
      agent,
      bindings,
      accessPolicy: { authorize: () => false },
    });

    let failure: unknown;
    try {
      await channel.receive({
        channelId: "http",
        address: "tenant-1/conversation-1",
        deliveryId: "request-1",
        message: "denied",
        principal: null,
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(ChannelAccessDeniedError);
    expect(
      await bindings.resolve({
        channelId: "http",
        address: "tenant-1/conversation-1",
      })
    ).toBeUndefined();
  });

  test("repairs a binding whose Session creation was interrupted", async () => {
    const engine = new ScriptedModelEngine([
      [
        { type: "text.delta", delta: "recovered" },
        { type: "finish", reason: "stop" },
      ],
    ]);
    const harness = createHarness({ engine });
    const agent = await harness.prepare(_generation());
    const bindings = new InMemoryChannelBindingRepository();
    const initiator = {
      attributes: { tenantId: "tenant-1" },
      authenticator: "fixture",
      principalId: "original-user",
      principalType: "user",
    };
    await bindings.claim({
      channelId: "http",
      address: "tenant-1/conversation-interrupted",
      sessionId: "session-interrupted",
      initiator,
      createdAt: 10,
    });
    const channel = createChannelRuntime({
      agent,
      bindings,
      accessPolicy: { authorize: () => true },
    });

    const receipt = await channel.receive({
      channelId: "http",
      address: "tenant-1/conversation-interrupted",
      deliveryId: "request-1",
      message: "resume",
      principal: {
        ...initiator,
        principalId: "retrying-user",
      },
    });

    expect(receipt).toMatchObject({
      sessionId: "session-interrupted",
      bindingCreated: false,
    });
    const session = await agent.attachSession(receipt.sessionId);
    expect(await session?.snapshot()).toMatchObject({
      auth: { initiator },
    });
  });

  test("keeps a durable binding when initial Session provisioning fails", async () => {
    const bindings = new InMemoryChannelBindingRepository();
    const failingHarness = createHarness({
      engine: new ScriptedModelEngine([]),
      repository: {
        create: () => Promise.reject(new Error("storage unavailable")),
        load: () => Promise.resolve(undefined),
        save: () => Promise.resolve(),
        delete: () => Promise.resolve(),
      },
    });
    const failingAgent = await failingHarness.prepare(_generation());
    const firstChannel = createChannelRuntime({
      agent: failingAgent,
      bindings,
      accessPolicy: { authorize: () => true },
      generateId: () => "session-durable-binding",
    });
    const firstEnvelope = {
      channelId: "http",
      address: "tenant-1/conversation-durable",
      deliveryId: "request-1",
      message: "first attempt",
      principal: null,
    };

    let provisioningError: unknown;
    try {
      await firstChannel.receive(firstEnvelope);
    } catch (error) {
      provisioningError = error;
    }
    expect(provisioningError).toBeInstanceOf(Error);
    expect((provisioningError as Error).message).toBe("storage unavailable");
    expect(await bindings.resolve(firstEnvelope)).toMatchObject({
      sessionId: "session-durable-binding",
    });

    const healthyHarness = createHarness({
      engine: new ScriptedModelEngine([
        [
          { type: "text.delta", delta: "repaired" },
          { type: "finish", reason: "stop" },
        ],
      ]),
    });
    const healthyAgent = await healthyHarness.prepare(_generation());
    const repaired = await createChannelRuntime({
      agent: healthyAgent,
      bindings,
      accessPolicy: { authorize: () => true },
    }).receive({
      ...firstEnvelope,
      deliveryId: "request-2",
      message: "repair",
    });

    expect(repaired).toMatchObject({
      sessionId: "session-durable-binding",
      bindingCreated: false,
    });
  });
});

function _generation(): LoadAgentResult {
  return {
    diagnostics: [],
    manifest: {
      kind: "llm-space-agent-manifest",
      agentId: "channel-fixture",
      agent: { model: "fixture/model" },
      channels: [],
      connections: [],
      extensions: [],
      hooks: [],
      instructions: [],
      schedules: [],
      skills: [],
      sandboxWorkspace: [],
      subagents: [],
      tools: [],
    },
    moduleMap: { nodes: { $root: { modules: {} } } },
    project: {
      agentRoot: "/fixture/agent",
      appRoot: "/fixture",
      layout: "nested",
    },
    sourceFingerprint: "channel-generation",
  };
}

async function _waitForTurn(
  session: AgentSession,
  turnId: string,
  afterSequence: number
): Promise<void> {
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
      return;
    }
  }
}
