import { expect, test } from "bun:test";

import { Container, ContainerModule, injectable, preDestroy } from "inversify";

import type { Disposable } from "../../shared/disposable";
import { defineRpcNamespace } from "../../shared/namespaced-rpc";

import {
  RpcContribution,
  type RpcContribution as RpcContributionApi,
} from "./rpc-contribution";
import { RpcRegistry } from "./rpc-registry";
import { windowRegistryModule } from "./window-registry-module";

interface FixtureRpc {
  readonly requests: { ping(): Promise<string> };
  readonly streams: Record<never, never>;
  readonly events: Record<never, never>;
}

const FIXTURE_RPC = defineRpcNamespace<FixtureRpc>("fixture", {
  requests: { ping: true },
  streams: {},
  events: {},
});

test("window RpcRegistry resolves its multi-contribution once", async () => {
  const desktop = new Container();
  const container = new Container({ parent: desktop });
  const lifecycle: string[] = [];
  let constructions = 0;
  @injectable()
  class FixtureContribution implements RpcContributionApi, Disposable {
    constructor() {
      constructions += 1;
    }

    registerRpc(rpc: RpcRegistry): void {
      rpc.registerServer({
        namespace: FIXTURE_RPC,
        requests: { ping: () => Promise.resolve("pong") },
        streams: {},
      });
    }

    @preDestroy()
    dispose(): void {
      lifecycle.push("contribution");
    }
  }
  container.load(
    new ContainerModule(({ bind }) => {
      bind(FixtureContribution).toSelf().inSingletonScope();
      bind<RpcContributionApi>(RpcContribution).toService(FixtureContribution);
    })
  );
  container.load(
    windowRegistryModule({
      rpcEventSink: {
        sendStreamEvent: () => undefined,
        sendEvent: () => undefined,
      },
    })
  );
  const rpc = container.get(RpcRegistry);
  rpc.onStart();

  expect(
    await rpc.request({ namespace: "fixture", method: "ping", args: [] })
  ).toEqual({ ok: true, value: "pong" });
  expect(container.get(RpcRegistry)).toBe(rpc);
  expect(constructions).toBe(1);

  await rpc.dispose();
  lifecycle.push("registry");
  await container.unbindAllAsync();
  expect(lifecycle).toEqual(["registry", "contribution"]);
  await desktop.unbindAllAsync();
});
