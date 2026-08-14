import { expect, test } from "bun:test";

import { EventHub } from "../../shared/event-hub";
import { defineRpcNamespace } from "../../shared/namespaced-rpc";

import { SnapshotContributionProvider } from "./contribution-provider";
import type { RpcContribution } from "./rpc-contribution";
import { RpcRegistry } from "./rpc-registry";

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

test("RPC Registry collects contributions and owns streams and events", async () => {
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
  const contribution: RpcContribution = {
    registerRpc(rpc) {
      rpc.registerServer(new FixtureRpcServer());
    },
  };
  const registry = new RpcRegistry(
    new SnapshotContributionProvider(() => [contribution]),
    {
      sendStreamEvent: (event) => events.push(event),
      sendEvent: (event) => published.push(event),
    }
  );
  registry.onStart();

  expect(
    await registry.request({
      namespace: "fixture",
      method: "greet",
      args: ["Ada"],
    })
  ).toEqual({ ok: true, value: "hello Ada" });
  eventSource.publish("changed", "next");
  registry.subscribe({
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
  await registry.dispose();
});

test("RPC Registry rejects duplicate and late namespace registration", () => {
  const server = {
    namespace: FIXTURE_RPC,
    requests: { greet: () => Promise.resolve("hello") },
    streams: {
      async *values() {
        await Promise.resolve();
        yield 1;
      },
    },
  };
  const contribution = (): RpcContribution => ({
    registerRpc: (rpc) => void rpc.registerServer(server),
  });
  const duplicate = new RpcRegistry(
    new SnapshotContributionProvider(() => [contribution(), contribution()]),
    { sendStreamEvent: () => undefined, sendEvent: () => undefined }
  );
  expect(() => duplicate.onStart()).toThrow(
    'RPC namespace "fixture" is already registered.'
  );

  const started = new RpcRegistry(new SnapshotContributionProvider(() => []), {
    sendStreamEvent: () => undefined,
    sendEvent: () => undefined,
  });
  started.onStart();
  expect(() => started.registerServer(server)).toThrow(
    "can only be registered while RpcRegistry is starting"
  );
});
