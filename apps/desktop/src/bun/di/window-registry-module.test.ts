import { expect, test } from "bun:test";

import { ContainerModule } from "inversify";

import type { Disposable } from "../../shared/disposable";
import { defineRpcNamespace } from "../../shared/namespaced-rpc";

import {
  CommandContribution,
  type CommandContribution as CommandContributionApi,
} from "./command-contribution";
import { CommandRegistry } from "./command-registry";
import { createDesktopProcessContainer } from "./process-container";
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

test("window Registries resolve one shared multi-contribution instance", async () => {
  const process = createDesktopProcessContainer();
  const scope = process.createWindowScope("fixture");
  const lifecycle: string[] = [];
  let constructions = 0;
  class FixtureContribution
    implements CommandContributionApi, RpcContributionApi, Disposable
  {
    constructor() {
      constructions += 1;
    }

    registerCommands(commands: CommandRegistry): void {
      commands.registerCommand("shell.reportBugs", {
        execute: () => lifecycle.push("command"),
      });
    }

    registerRpc(rpc: RpcRegistry): void {
      rpc.registerServer({
        namespace: FIXTURE_RPC,
        requests: { ping: () => Promise.resolve("pong") },
        streams: {},
      });
    }

    dispose(): void {
      lifecycle.push("contribution");
    }
  }
  scope.load(
    new ContainerModule(({ bind }) => {
      bind(FixtureContribution)
        .toDynamicValue(() => new FixtureContribution())
        .inSingletonScope();
      bind<CommandContributionApi>(CommandContribution).toService(
        FixtureContribution
      );
      bind<RpcContributionApi>(RpcContribution).toService(FixtureContribution);
    })
  );
  scope.load(
    windowRegistryModule(scope, {
      commandSink: { sendToWebview: () => undefined },
      rpcEventSink: {
        sendStreamEvent: () => undefined,
        sendEvent: () => undefined,
      },
    })
  );
  const commands = scope.get(CommandRegistry);
  const rpc = scope.get(RpcRegistry);
  commands.onStart();
  rpc.onStart();
  scope.onDispose(async () => {
    await rpc.dispose();
    await commands.dispose();
    lifecycle.push("registries");
  });

  commands.execute({ type: "shell.reportBugs", args: {} });
  expect(
    await rpc.request({ namespace: "fixture", method: "ping", args: [] })
  ).toEqual({ ok: true, value: "pong" });
  expect(scope.get(CommandRegistry)).toBe(commands);
  expect(scope.get(RpcRegistry)).toBe(rpc);
  expect(constructions).toBe(1);

  await scope.dispose();
  expect(lifecycle).toEqual(["command", "registries", "contribution"]);
  await process.dispose();
});
