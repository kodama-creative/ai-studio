import { beforeEach, expect, mock, test } from "bun:test";

import type { RunFrame } from "@llm-space/engine";

import type { PlaygroundRunFramePayload } from "@/shared/rpc";

type Listener = (message: PlaygroundRunFramePayload) => void;

class ControllableRpc {
  readonly subscriptions: { subscriptionId: string; runId: string }[] = [];
  readonly unsubscriptions: { subscriptionId: string }[] = [];
  private readonly _listeners = new Set<Listener>();

  readonly request = {};
  readonly send = {
    playgroundRunSubscribe: (input: {
      subscriptionId: string;
      runId: string;
    }) => this.subscriptions.push(input),
    playgroundRunUnsubscribe: (input: { subscriptionId: string }) =>
      this.unsubscriptions.push(input),
  };

  addMessageListener(_name: "receivePlaygroundRunFrame", listener: Listener) {
    this._listeners.add(listener);
  }

  removeMessageListener(
    _name: "receivePlaygroundRunFrame",
    listener: Listener
  ) {
    this._listeners.delete(listener);
  }

  emit(message: PlaygroundRunFramePayload) {
    for (const listener of this._listeners) listener(message);
  }

  reset() {
    this.subscriptions.length = 0;
    this.unsubscriptions.length = 0;
    this._listeners.clear();
  }
}

const RPC = new ControllableRpc();
await mock.module("@/lib/electrobun", () => ({ electrobun: { rpc: RPC } }));
const { createPlaygroundClient } = await import("./playground-client");

beforeEach(() => RPC.reset());

test("Playground Run stream drains frames and terminates on done", async () => {
  const iterator = createPlaygroundClient()
    .streamRun("run-1")
    [Symbol.asyncIterator]();
  const first = iterator.next();
  const subscriptionId = RPC.subscriptions[0]?.subscriptionId;
  if (subscriptionId === undefined) throw new Error("Missing subscription.");
  const frame = {
    type: "snapshot",
    cursor: 0,
    run: {
      schemaVersion: 1,
      id: "run-1",
      threadId: "thread-1",
      operationId: "operation-1",
      inputMessages: [
        {
          id: "user-1",
          role: "user",
          content: [{ type: "text", text: "hello" }],
        },
      ],
      baseCheckpointId: "checkpoint-1",
      inputCheckpointId: "checkpoint-2",
      agentSnapshot: {
        schemaVersion: 1,
        agentId: "agent",
        generationId: "generation",
        model: "test/model",
        instructions: [],
        tools: [],
      },
      control: { mode: "continue" },
      status: "completed",
      createdAt: 1,
    },
    outputs: [],
    headCheckpointId: "checkpoint-2",
  } satisfies RunFrame;

  RPC.emit({ subscriptionId, type: "frame", frame });
  RPC.emit({ subscriptionId, type: "done" });

  expect(await first).toEqual({ value: frame, done: false });
  expect(await iterator.next()).toEqual({ value: undefined, done: true });
  expect(RPC.unsubscriptions).toEqual([{ subscriptionId }]);
});
