import { beforeEach, expect, mock, test } from "bun:test";

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

  removeMessageListener(
    _name: "rpcNamespaceEvent",
    _listener: () => void
  ): void;
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
