import { expect, expectTypeOf, test } from "bun:test";

import {
  createRpcClient,
  defineRpcNamespace,
  type NamespacedRpcRequest,
  type RpcClient,
  type RpcClientTransport,
} from "./namespaced-rpc";

interface FixtureRpc {
  readonly requests: {
    read(id: string): Promise<{ readonly id: string }>;
    readOptional(
      id: string,
      options?: { readonly fresh?: boolean }
    ): Promise<{ readonly id: string }>;
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
  requests: { read: true, readOptional: true },
  streams: { changes: true },
  events: { changed: true },
});

test("typed RPC client serializes requests and strips local stream signals", async () => {
  const calls: unknown[] = [];
  const controller = new AbortController();
  const transport: RpcClientTransport = {
    request(input) {
      calls.push(JSON.parse(JSON.stringify(input)));
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
  const client: RpcClient<FixtureRpc> = createRpcClient(
    FIXTURE_RPC,
    transport
  );

  expectTypeOf(client.read).parameters.toEqualTypeOf<[id: string]>();
  expectTypeOf(client.read).returns.toEqualTypeOf<
    Promise<{ readonly id: string }>
  >();
  expect(await client.read("a")).toEqual({ id: "a" });
  expect(await client.readOptional("b", undefined)).toEqual({ id: "b" });
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
    { namespace: "fixture", method: "readOptional", args: ["b"] },
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

test("RPC clients are values rather than thenables", async () => {
  const calls: NamespacedRpcRequest[] = [];
  const transport: RpcClientTransport = {
    request(input) {
      calls.push(input);
      if (input.method === "then") {
        const resolve = input.args[0];
        if (_isResolver(resolve)) resolve("assimilated");
      }
      return Promise.resolve({ ok: true, value: undefined });
    },
    async *stream() {
      await Promise.resolve();
      yield* [];
    },
    subscribe: () => ({ dispose: () => undefined }),
  };
  const client = createRpcClient(FIXTURE_RPC, transport);

  async function passThroughAsyncBoundary(): Promise<RpcClient<FixtureRpc>> {
    await Promise.resolve();
    return client;
  }

  expect(await passThroughAsyncBoundary()).toBe(client);
  expect(calls).toEqual([]);
});

test("RPC clients expose only stable declared members", () => {
  const calls: NamespacedRpcRequest[] = [];
  const client = createRpcClient(FIXTURE_RPC, {
    request(input) {
      calls.push(input);
      return Promise.resolve({ ok: true, value: undefined });
    },
    async *stream() {
      await Promise.resolve();
      yield* [];
    },
    subscribe: () => ({ dispose: () => undefined }),
  });

  expect(client.read).toBe(client.read);
  expect("read" in client).toBe(true);
  expect(Reflect.get(client, "then")).toBeUndefined();
  expect(Reflect.get(client, "toJSON")).toBeUndefined();
  expect(Reflect.get(client, "typo")).toBeUndefined();
  expect(JSON.stringify(client)).toBe("{}");
  expect(Object.isFrozen(client)).toBe(true);
  expect(calls).toEqual([]);
});

test("RPC namespace manifests are runtime-immutable snapshots", () => {
  expect(Object.isFrozen(FIXTURE_RPC)).toBe(true);
  expect(Object.isFrozen(FIXTURE_RPC.requestNames)).toBe(true);
  expect([...FIXTURE_RPC.requestNames]).toEqual(["read", "readOptional"]);
  expect(Reflect.get(FIXTURE_RPC.requestNames, "add")).toBeUndefined();
  expect(Reflect.set(FIXTURE_RPC, "name", "mutated")).toBe(false);
  expect(FIXTURE_RPC.name).toBe("fixture");
});

function _isResolver(value: unknown): value is (result: unknown) => void {
  return typeof value === "function";
}

test("RPC namespace manifests reject ambiguous client members", () => {
  interface ThenRpc {
    readonly requests: { then(): Promise<void> };
    readonly streams: Record<never, never>;
    readonly events: Record<never, never>;
  }
  expect(() =>
    defineRpcNamespace<ThenRpc>("reserved", {
      requests: { then: true },
      streams: {},
      events: {},
    })
  ).toThrow('uses reserved client member "then"');

  interface AmbiguousRpc {
    readonly requests: { duplicate(): Promise<void> };
    readonly streams: { duplicate(): AsyncIterable<void> };
    readonly events: Record<never, never>;
  }
  expect(() =>
    defineRpcNamespace<AmbiguousRpc>("ambiguous", {
      requests: { duplicate: true },
      streams: { duplicate: true },
      events: {},
    })
  ).toThrow('cannot be both a request and a stream');
});
