import { expect, test } from "bun:test";

import type { RunFrame } from "@llm-space/engine";

import { DesktopPlaygroundApplicationImpl } from "../application/playground-application";
import type { PlaygroundHost } from "../playgrounds/playground-host";

import { PlaygroundRpcServer } from "./playground-rpc-server";

test("Playground RPC server delegates requests and follows Run streams", async () => {
  const cursors: unknown[] = [];
  const host = {
    listPlaygrounds: () => Promise.resolve([]),
    async *streamRun(_runId: string, cursor: unknown) {
      await Promise.resolve();
      cursors.push(cursor);
      yield { cursor: 1 } as RunFrame;
    },
  } as unknown as PlaygroundHost;
  const server = new PlaygroundRpcServer(
    new DesktopPlaygroundApplicationImpl(host)
  );
  const controller = new AbortController();

  expect(await server.requests.list()).toEqual([]);
  const frames: RunFrame[] = [];
  for await (const frame of server.streams.streamRun("run-1", {
    afterCursor: 3,
    signal: controller.signal,
  })) {
    frames.push(frame);
  }

  expect(cursors).toEqual([
    { afterCursor: 3, signal: controller.signal, follow: true },
  ]);
  expect(frames).toHaveLength(1);
  expect(frames[0]?.cursor).toBe(1);
});
