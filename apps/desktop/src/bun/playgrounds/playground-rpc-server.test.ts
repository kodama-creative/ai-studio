import { expect, test } from "bun:test";

import type { DesktopPlaygroundApplication } from "./playground-application";
import { PlaygroundRpcServer } from "./playground-rpc-server";

test("Playground RPC server exposes metadata and no execution stream", async () => {
  const host = {
    listPlaygrounds: () => Promise.resolve([]),
  } as unknown as DesktopPlaygroundApplication;
  const server = new PlaygroundRpcServer(host);

  expect(await server.requests.list()).toEqual([]);
  expect(server.streams).toEqual({});
});
