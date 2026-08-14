import { describe, expect, test } from "bun:test";

import type { AgentEvent, AgentStreamRequest } from "@llm-space/core";
import { RuntimeRouter, type RuntimeClient } from "@llm-space/runtime/runtime";

import { AgentExecutionApplicationImpl } from "./runtime-applications";

const REQUEST: AgentStreamRequest = {
  model: { provider: "test", id: "test" },
  context: { messages: [], tools: [], responseApiNativeTools: [] },
};

function _application(input: {
  stream: RuntimeClient["streamThread"];
  abort?: RuntimeClient["abortStream"];
}) {
  const runtime = {
    info: () => ({
      id: "local" as const,
      kind: "local" as const,
      name: "Local",
      status: "connected" as const,
      capabilities: ["streamThread" as const],
    }),
    streamThread: input.stream,
    abortStream: input.abort ?? (() => undefined),
  } as RuntimeClient;
  return new AgentExecutionApplicationImpl(new RuntimeRouter(runtime));
}

describe("AgentExecutionApplication", () => {
  test("preserves burst event order before terminal completion", async () => {
    const events: AgentEvent[] = Array.from({ length: 4096 }, (_, index) => ({
      type: "tool_execution_start" as const,
      toolCallId: String(index),
      toolName: "test",
      args: { index },
    }));
    const application = _application({
      stream: async (input, send) => {
        await Promise.resolve();
        for (const event of events) {
          send({ streamId: input.streamId, type: "event", event });
        }
        send({ streamId: input.streamId, type: "done" });
      },
    });

    const received: AgentEvent[] = [];
    for await (const event of application.stream("local", REQUEST)) {
      received.push(event);
    }
    expect(received).toEqual(events);
  });

  test("rejects an already aborted stream without starting the runtime", async () => {
    let started = false;
    const application = _application({
      stream: async () => {
        await Promise.resolve();
        started = true;
      },
    });
    const controller = new AbortController();
    controller.abort();

    const error = await _consume(
      application.stream("local", REQUEST, { signal: controller.signal })
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(DOMException);
    expect(error).toHaveProperty("name", "AbortError");
    expect(started).toBe(false);
  });

  test("aborts a live runtime once and rejects the iterator", async () => {
    const controller = new AbortController();
    let aborts = 0;
    let start!: () => void;
    let finish!: () => void;
    const started = new Promise<void>((resolve) => {
      start = resolve;
    });
    const application = _application({
      stream: async () => {
        start();
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
      },
      abort: () => {
        aborts += 1;
        finish();
      },
    });
    const consumption = _consume(
      application.stream("local", REQUEST, { signal: controller.signal })
    );
    await started;
    controller.abort();

    const error = await consumption.catch((caught: unknown) => caught);
    expect(error).toHaveProperty("name", "AbortError");
    expect(aborts).toBe(1);
  });
});

async function _consume(iterable: AsyncIterable<AgentEvent>): Promise<void> {
  const iterator = iterable[Symbol.asyncIterator]();
  while (!(await iterator.next()).done) {
    // Consumption itself is the behavior under test.
  }
}
