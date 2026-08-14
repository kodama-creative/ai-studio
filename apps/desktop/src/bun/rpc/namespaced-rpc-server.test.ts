import { expect, test } from "bun:test";

import { EventHub } from "../../shared/event-hub";
import { defineRpcNamespace } from "../../shared/namespaced-rpc";

import { NamespacedRpcServer } from "./namespaced-rpc-server";

interface FixtureRpc {
  readonly requests: {
    greet(name: string): Promise<string>;
  };
  readonly streams: {
    values(input: {
      readonly count: number;
      readonly signal?: AbortSignal;
    }): AsyncIterable<number>;
  };
  readonly events: {
    changed: string;
  };
}

const FIXTURE_RPC = defineRpcNamespace<FixtureRpc>("fixture", {
  streams: ["values"],
  events: ["changed"],
});

test("namespaced RPC server dispatches class methods and owns streams", async () => {
  const events: unknown[] = [];
  const published: unknown[] = [];
  const eventSource = new EventHub<{ changed: string }>();
  let streamedSignal: AbortSignal | undefined;
  class FixtureRpcServer {
    readonly namespace = FIXTURE_RPC;
    readonly requests = this;
    readonly streams = this;
    readonly eventSource = eventSource;

    greet(name: string): Promise<string> {
      return Promise.resolve(`hello ${name}`);
    }

    async *values(input: {
      readonly count: number;
      readonly signal?: AbortSignal;
    }): AsyncIterable<number> {
      await Promise.resolve();
      streamedSignal = input.signal;
      for (let value = 0; value < input.count; value += 1) yield value;
    }
  }
  const server = new NamespacedRpcServer({
    sendStreamEvent: (event) => events.push(event),
    sendEvent: (event) => published.push(event),
  });
  server.register(new FixtureRpcServer());

  expect(
    await server.request({
      namespace: "fixture",
      method: "greet",
      args: ["Ada"],
    })
  ).toEqual({ ok: true, value: "hello Ada" });
  eventSource.publish("changed", "next");
  server.subscribe({
    subscriptionId: "subscription-1",
    namespace: "fixture",
    method: "values",
    args: [{ count: 2 }],
  });
  await new Promise<void>((resolve) => setTimeout(resolve, 0));

  expect(streamedSignal).toBeInstanceOf(AbortSignal);
  expect(events).toEqual([
    { subscriptionId: "subscription-1", type: "item", item: 0 },
    { subscriptionId: "subscription-1", type: "item", item: 1 },
    { subscriptionId: "subscription-1", type: "done" },
  ]);
  expect(published).toEqual([
    { namespace: "fixture", event: "changed", payload: "next" },
  ]);
  await server.dispose();
});

test("namespaced RPC server rejects duplicate and unknown modules", () => {
  const server = new NamespacedRpcServer({
    sendStreamEvent: () => undefined,
    sendEvent: () => undefined,
  });
  const module = {
    namespace: FIXTURE_RPC,
    requests: { greet: () => Promise.resolve("hello") },
    streams: {
      async *values() {
        await Promise.resolve();
        yield 1;
      },
    },
  };
  server.register(module);

  expect(() => server.register(module)).toThrow(
    'RPC namespace "fixture" is already registered.'
  );
  expect(
    server.request({ namespace: "missing", method: "read", args: [] })
  ).resolves.toEqual({
    ok: false,
    error: {
      code: "INTERNAL",
      message: "Internal RPC error.",
    },
  });
});
