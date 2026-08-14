import { expect, test } from "bun:test";

import { DesktopPlaygroundApplicationImpl } from "../application/playground-application";
import type { PlaygroundHost } from "../playgrounds/playground-host";

import { PlaygroundRpcServer } from "./playground-rpc-server";

test("Playground RPC server exposes metadata and no execution stream", async () => {
  const host = {
    listPlaygrounds: () => Promise.resolve([]),
  } as unknown as PlaygroundHost;
  const server = new PlaygroundRpcServer(
    new DesktopPlaygroundApplicationImpl(host)
  );

  expect(await server.requests.list()).toEqual([]);
  expect(server.streams).toEqual({});
});
