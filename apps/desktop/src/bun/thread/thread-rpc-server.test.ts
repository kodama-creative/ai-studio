import { expect, test } from "bun:test";

import type { StudioApplication } from "@llm-space/studio";

import type { DesktopPlaygroundApplication } from "../playgrounds/playground-application";

import {
  PlaygroundThreadRpcServer,
  StudioThreadRpcServer,
} from "./thread-rpc-server";

test("Playground Thread RPC delegates execution through product identity", async () => {
  const calls: unknown[] = [];
  const application = {
    run(playgroundId: string, input: unknown) {
      calls.push(["run", playgroundId, input]);
      return Promise.resolve({ sessionId: "session-1", operationId: "run-1" });
    },
  } as unknown as DesktopPlaygroundApplication;
  const server = new PlaygroundThreadRpcServer(application);

  const result = await server.requests.run(
    { kind: "playground", playgroundId: "playground-1" },
    { fromMessageId: "user-1", commandId: "command-1", mode: "step" }
  );
  expect(result).toEqual({ sessionId: "session-1", operationId: "run-1" });
  expect(calls).toEqual([
    [
      "run",
      "playground-1",
      {
        fromMessageId: "user-1",
        commandId: "command-1",
        mode: "step",
      },
    ],
  ]);
});

test("Studio Thread RPC rejects another Project before executing", () => {
  const application = {
    run() {
      throw new Error("must not execute");
    },
  } as unknown as StudioApplication;
  const server = new StudioThreadRpcServer(application, "project-1");

  expect(
    server.requests.run(
      {
        kind: "experiment",
        projectId: "project-2",
        experimentId: "experiment-1",
      },
      { fromMessageId: "user-1", commandId: "command-1", mode: "step" }
    )
  ).rejects.toThrow('Project "project-2" is not open in this Studio window.');
});

test("Thread RPC passes the selected product target to debugger mutations", async () => {
  const calls: unknown[] = [];
  const application = {
    inspectRun(playgroundId: string, operationId: string) {
      calls.push([playgroundId, operationId]);
      return Promise.resolve({ status: "paused" });
    },
  } as unknown as DesktopPlaygroundApplication;
  const server = new PlaygroundThreadRpcServer(application);

  await server.requests.inspect(
    { kind: "playground", playgroundId: "playground-selected" },
    "operation-1"
  );

  expect(calls).toEqual([["playground-selected", "operation-1"]]);
});

test("Thread RPC aborts the active Pi operation when its request is cancelled", async () => {
  const calls: string[] = [];
  let release: (() => void) | undefined;
  const application = {
    run() {
      calls.push("run");
      return new Promise<{ sessionId: string; operationId: string }>((resolve) => {
        release = () =>
          resolve({ sessionId: "session-1", operationId: "operation-1" });
      });
    },
    cancelActiveRun() {
      calls.push("cancel-active");
      release?.();
      return Promise.resolve();
    },
  } as unknown as DesktopPlaygroundApplication;
  const server = new PlaygroundThreadRpcServer(application);
  const controller = new AbortController();

  const result = server.requests.run(
    { kind: "playground", playgroundId: "playground-1" },
    {
      fromMessageId: "user-1",
      commandId: "command-1",
      mode: "continue",
      signal: controller.signal,
    }
  );
  await Promise.resolve();
  controller.abort();

  expect(await result).toEqual({
    sessionId: "session-1",
    operationId: "operation-1",
  });
  expect(calls).toEqual(["run", "cancel-active"]);
});
