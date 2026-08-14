import { beforeEach, expect, mock, test } from "bun:test";

import type { RunFrame } from "@llm-space/engine";

import type {
  NamespacedRpcRequest,
  NamespacedRpcStreamEvent,
  NamespacedRpcStreamSubscribe,
} from "@/shared/namespaced-rpc";

type Listener = (message: NamespacedRpcStreamEvent) => void;

class ControllableRpc {
  readonly requests: NamespacedRpcRequest[] = [];
  readonly subscriptions: NamespacedRpcStreamSubscribe[] = [];
  readonly unsubscriptions: { subscriptionId: string }[] = [];
  private readonly _listeners = new Set<Listener>();

  readonly request = {
    rpcNamespaceRequest: (input: NamespacedRpcRequest) => {
      this.requests.push(input);
      return Promise.resolve({ ok: true as const, value: [] });
    },
  };

  readonly send = {
    rpcNamespaceStreamSubscribe: (input: NamespacedRpcStreamSubscribe) =>
      this.subscriptions.push(input),
    rpcNamespaceStreamUnsubscribe: (input: { subscriptionId: string }) =>
      this.unsubscriptions.push(input),
  };

  addMessageListener(_name: "rpcNamespaceEvent", _listener: () => void): void;
  addMessageListener(
    _name: "rpcNamespaceStreamEvent" | "rpcNamespaceEvent",
    listener: Listener | (() => void)
  ) {
    if (_name === "rpcNamespaceStreamEvent") {
      this._listeners.add(listener);
    }
  }

  removeMessageListener(_name: "rpcNamespaceEvent", _listener: () => void): void;
  removeMessageListener(
    _name: "rpcNamespaceStreamEvent" | "rpcNamespaceEvent",
    listener: Listener | (() => void)
  ) {
    if (_name === "rpcNamespaceStreamEvent") {
      this._listeners.delete(listener);
    }
  }

  emit(message: NamespacedRpcStreamEvent) {
    for (const listener of this._listeners) listener(message);
  }

  reset() {
    this.requests.length = 0;
    this.subscriptions.length = 0;
    this.unsubscriptions.length = 0;
    this._listeners.clear();
  }
}

const RPC = new ControllableRpc();
await mock.module("@/lib/electrobun", () => ({ electrobun: { rpc: RPC } }));
const { createPlaygroundClient } = await import("./playground-client");

beforeEach(() => RPC.reset());

test("Playground client routes requests through its namespace", async () => {
  await createPlaygroundClient().list();

  expect(RPC.requests).toEqual([
    { namespace: "playground", method: "list", args: [] },
  ]);
});

test("Playground Run stream uses the shared namespace transport", async () => {
  const iterator = createPlaygroundClient()
    .streamRun("run-1")
    [Symbol.asyncIterator]();
  const first = iterator.next();
  const subscription = RPC.subscriptions[0];
  if (subscription === undefined) throw new Error("Missing subscription.");
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

  expect(subscription).toMatchObject({
    namespace: "playground",
    method: "streamRun",
    args: ["run-1"],
  });
  RPC.emit({
    subscriptionId: subscription.subscriptionId,
    type: "item",
    item: frame,
  });
  RPC.emit({ subscriptionId: subscription.subscriptionId, type: "done" });

  expect(await first).toEqual({ value: frame, done: false });
  expect(await iterator.next()).toEqual({ value: undefined, done: true });
  expect(RPC.unsubscriptions).toEqual([
    { subscriptionId: subscription.subscriptionId },
  ]);
});
