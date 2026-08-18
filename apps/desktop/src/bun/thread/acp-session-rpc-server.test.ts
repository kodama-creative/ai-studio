import { expect, test } from "bun:test";

import type { DesktopPlaygroundApplication } from "../playgrounds/playground-application";

import { PlaygroundAcpSessionRpcServer } from "./acp-session-rpc-server";

test("Desktop ACP prompt validates the product-owned Session", () => {
  const application = {
    openExecution: () => Promise.resolve(_snapshot()),
    run: () => Promise.reject(new Error("must not execute")),
  } as unknown as DesktopPlaygroundApplication;
  const server = new PlaygroundAcpSessionRpcServer(application);

  expect(
    server.requests.prompt(
      { kind: "playground", playgroundId: "playground-1" },
      {
        request: {
          sessionId: "foreign-session",
          prompt: [{ type: "text", text: "hello" }],
        },
        context: [],
        messageId: "user-1",
        mode: "step",
      }
    )
  ).rejects.toThrow(
    'ACP Session "foreign-session" does not belong to the selected product.'
  );
});

test("Desktop ACP prompt rebuilds execution messages only from ACP input", async () => {
  let received: unknown;
  const application = {
    openExecution: () => Promise.resolve(_snapshot()),
    run: (_id: string, input: unknown) => {
      received = input;
      return Promise.resolve({ sessionId: "session-1", operationId: "run-1" });
    },
  } as unknown as DesktopPlaygroundApplication;
  const server = new PlaygroundAcpSessionRpcServer(application);

  await server.requests.prompt(
    { kind: "playground", playgroundId: "playground-1" },
    {
      request: {
        sessionId: "session-1",
        prompt: [{ type: "text", text: "current" }],
      },
      context: [
        {
          sessionUpdate: "user_message",
          messageId: "user-previous",
          content: [{ type: "text", text: "previous" }],
        },
      ],
      messageId: "user-current",
      mode: "step",
    }
  );

  expect(received).toMatchObject({
    messages: [
      { id: "user-previous", role: "user", content: [{ text: "previous" }] },
      { id: "user-current", role: "user", content: [{ text: "current" }] },
    ],
    mode: "step",
  });
});

test("Desktop ACP resume emits a cursor-bearing state barrier", async () => {
  const application = {
    readExecution: () =>
      Promise.resolve({
        fromCursor: 0,
        cursor: 7,
        items: [],
        snapshot: _snapshot(7),
      }),
  } as unknown as DesktopPlaygroundApplication;
  const server = new PlaygroundAcpSessionRpcServer(application);
  const stream = server.streams
    .updates({ kind: "playground", playgroundId: "playground-1" })
    [Symbol.asyncIterator]();

  expect(await stream.next()).toEqual({
    done: false,
    value: {
      sessionId: "session-1",
      update: {
        sessionUpdate: "state_update",
        state: "idle",
        _meta: {
          "llm-space.dev": {
            cursor: 7,
            lane: "main",
            status: "idle",
            leafId: null,
          },
        },
      },
      _meta: { "llm-space.dev": { cursor: 7 } },
    },
  });
  await stream.return?.();
});

test("Desktop ACP stream carries transient Engine running state", async () => {
  const application = {
    readExecution: () =>
      Promise.resolve({
        fromCursor: 0,
        cursor: 7,
        items: [],
        snapshot: _snapshot(7),
      }),
    async *observeExecution() {
      await Promise.resolve();
      yield { type: "state" as const, state: "running" as const };
    },
  } as unknown as DesktopPlaygroundApplication;
  const server = new PlaygroundAcpSessionRpcServer(application);
  const stream = server.streams
    .updates({ kind: "playground", playgroundId: "playground-1" })
    [Symbol.asyncIterator]();

  await stream.next();
  expect((await stream.next()).value).toEqual({
    sessionId: "session-1",
    update: { sessionUpdate: "state_update", state: "running" },
    _meta: { "llm-space.dev": { cursor: 7 } },
  });
});

function _snapshot(cursor = 0) {
  return {
    cursor,
    sessionId: "session-1",
    lane: "main",
    status: "idle" as const,
    messageEntries: [],
    messages: [],
    leafId: null,
  };
}
