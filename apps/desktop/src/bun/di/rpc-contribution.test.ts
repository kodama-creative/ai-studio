import { expect, test } from "bun:test";

import { ContainerModule } from "inversify";

import { defineRpcNamespace } from "../../shared/namespaced-rpc";

import { createDesktopProcessContainer } from "./process-container";
import {
  createWindowRpcServers,
  RPC_SERVER_CONTRIBUTION,
  type RpcServerContribution,
} from "./rpc-contribution";

const MAIN_RPC = defineRpcNamespace("main-only", { streams: [], events: [] });
const PROJECT_RPC = defineRpcNamespace("project-only", {
  streams: [],
  events: [],
});

test("RPC contributions construct only inside allowed window scopes", async () => {
  const process = createDesktopProcessContainer();
  const disposed: string[] = [];
  process.load(
    new ContainerModule(({ bind }) => {
      bind<RpcServerContribution>(RPC_SERVER_CONTRIBUTION).toConstantValue({
        id: "test.main",
        windows: ["main"],
        create: () => ({
          namespace: MAIN_RPC,
          requests: {},
          streams: {},
          dispose: () => disposed.push("main"),
        }),
      });
      bind<RpcServerContribution>(RPC_SERVER_CONTRIBUTION).toConstantValue({
        id: "test.project",
        windows: ["project"],
        create: () => ({
          namespace: PROJECT_RPC,
          requests: {},
          streams: {},
        }),
      });
    })
  );
  const main = process.createWindowScope("main");

  expect(createWindowRpcServers(main, "main").map((server) => server.namespace.name)).toEqual([
    "main-only",
  ]);
  await main.dispose();
  expect(disposed).toEqual(["main"]);
  await process.dispose();
});
