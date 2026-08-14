import { expect, expectTypeOf, test } from "bun:test";

import {
  createRpcClientProxy,
  defineRpcNamespace,
  type RpcClient,
  type RpcClientTransport,
} from "./namespaced-rpc";

interface FixtureRpc {
  readonly requests: {
    read(id: string): Promise<{ readonly id: string }>;
  };
  readonly streams: {
    changes(input?: {
      readonly after?: number;
      readonly signal?: AbortSignal;
    }): AsyncIterable<number>;
  };
  readonly events: {
    changed: { readonly id: string };
  };
}

const FIXTURE_RPC = defineRpcNamespace<FixtureRpc>("fixture", {
  streams: ["changes"],
  events: ["changed"],
});

test("typed RPC proxy routes requests and strips local stream signals", async () => {
  const calls: unknown[] = [];
  const controller = new AbortController();
  const transport: RpcClientTransport = {
    request(input) {
      calls.push(input);
      return Promise.resolve({ ok: true, value: { id: input.args[0] } });
    },
    async *stream(input) {
      await Promise.resolve();
      calls.push(input);
      yield 2;
    },
    subscribe(namespace, event, listener) {
      calls.push({ namespace, event });
      listener({ id: "event-a" });
      return {
        dispose: () => {
          calls.push("disposed");
        },
      };
    },
  };
  const client: RpcClient<FixtureRpc> = createRpcClientProxy(
    FIXTURE_RPC,
    transport
  );

  expectTypeOf(client.read).parameters.toEqualTypeOf<[id: string]>();
  expectTypeOf(client.read).returns.toEqualTypeOf<
    Promise<{ readonly id: string }>
  >();
  expect(await client.read("a")).toEqual({ id: "a" });
  const changes = [];
  for await (const value of client.changes({
    after: 1,
    signal: controller.signal,
  })) {
    changes.push(value);
  }

  expect(changes).toEqual([2]);
  const eventValues: unknown[] = [];
  const subscription = client.on("changed", (value) => eventValues.push(value));
  await subscription.dispose();
  expect(eventValues).toEqual([{ id: "event-a" }]);
  expect(calls).toEqual([
    { namespace: "fixture", method: "read", args: ["a"] },
    {
      namespace: "fixture",
      method: "changes",
      args: [{ after: 1 }],
      signal: controller.signal,
    },
    { namespace: "fixture", event: "changed" },
    "disposed",
  ]);
});
