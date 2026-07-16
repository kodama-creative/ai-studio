import { describe, expect, test } from "bun:test";

import {
  AgentServerClientError,
  createAgentServerClient
} from "./agent-server-client";

describe("Agent Server browser client", () => {
  test("honors HTTP Retry-After before reconnecting", async () => {
    let calls = 0;
    const client = createAgentServerClient({
      baseUrl: "https://agent.example",
      authorization: "test-token",
      retryCapMs: 50,
      fetch: (async () => {
        calls += 1;
        return calls === 1
          ? new Response(null, {
            status: 503,
            headers: { "retry-after": "0.02" }
          })
          : _sseResponse(_terminalFrame(1));
      }) as unknown as typeof globalThis.fetch
    });
    const startedAt = Date.now();
    const events = [];
    const connectionStates: string[] = [];
    for await (const event of client.streamRun({
      ..._streamInput(),
      onConnectionStateChange: state => { connectionStates.push(state); }
    })) {
      events.push(event);
    }
    expect(calls).toBe(2);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(15);
    expect(events).toHaveLength(1);
    expect(connectionStates).toEqual(["reconnecting", "connected"]);
  });

  test("uses serverShutdown retry hints without advancing the cursor", async () => {
    let calls = 0;
    const client = createAgentServerClient({
      baseUrl: "https://agent.example",
      authorization: "test-token",
      retryCapMs: 50,
      fetch: (async () => {
        calls += 1;
        return calls === 1
          ? _sseResponse(
            "event: control\ndata: {\"type\":\"serverShutdown\",\"retryAfterSeconds\":0.02}\n\n"
          )
          : _sseResponse(_terminalFrame(1));
      }) as unknown as typeof globalThis.fetch
    });
    const startedAt = Date.now();
    const events = [];
    for await (const event of client.streamRun(_streamInput())) {
      events.push(event);
    }
    expect(calls).toBe(2);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(15);
    expect(events.map(event => event.sequence)).toEqual([null, 1]);
  });

  test("deduplicates only exact cursor replays after a transport failure", async () => {
    let calls = 0;
    const firstFrame = "id: 1\nevent: pi\ndata: {\"type\":\"agent_start\"}\n\n";
    const client = createAgentServerClient({
      baseUrl: "https://agent.example",
      authorization: "test-token",
      retryCapMs: 1,
      fetch: (async () => {
        calls += 1;
        return calls === 1
          ? _failedSseResponse(firstFrame)
          : _sseResponse(`${firstFrame}${_terminalFrame(2)}`);
      }) as unknown as typeof globalThis.fetch
    });
    const events = [];
    for await (const event of client.streamRun(_streamInput())) {
      events.push(event);
    }
    expect(events.map(event => event.sequence)).toEqual([1, 2]);

    let mismatchCalls = 0;
    const mismatchClient = createAgentServerClient({
      baseUrl: "https://agent.example",
      authorization: "test-token",
      retryCapMs: 1,
      fetch: (async () => {
        mismatchCalls += 1;
        return mismatchCalls === 1
          ? _failedSseResponse(firstFrame)
          : _sseResponse(
            "id: 1\nevent: pi\ndata: {\"type\":\"turn_start\"}\n\n"
          );
      }) as unknown as typeof globalThis.fetch
    });
    try {
      for await (const event of mismatchClient.streamRun(_streamInput())) {
        void event;
      }
      throw new Error("Expected a mismatched replay to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(AgentServerClientError);
      expect(error).toMatchObject({ code: "event_replay_mismatch" });
    }
  });

  test("reconnects without parsing a clean-EOF partial frame", async () => {
    let calls = 0;
    const client = createAgentServerClient({
      baseUrl: "https://agent.example",
      authorization: "test-token",
      retryCapMs: 1,
      fetch: (async () => {
        calls += 1;
        return calls === 1
          ? _sseResponse(
            "id: 1\nevent: pi\ndata: {\"type\":\"agent_start\"}"
          )
          : _sseResponse(_terminalFrame(1));
      }) as unknown as typeof globalThis.fetch
    });
    const events = [];
    for await (const event of client.streamRun(_streamInput())) {
      events.push(event);
    }
    expect(calls).toBe(2);
    expect(events.map(event => event.sequence)).toEqual([1]);
    expect(events[0]).toMatchObject({
      data: { type: "runTerminal", outcome: "completed" }
    });
  });

  test("does not retry authorization failures", async () => {
    let fetchCalls = 0;
    const client = createAgentServerClient({
      baseUrl: "https://agent.example",
      authorization: () => { throw new Error("auth unavailable"); },
      fetch: (async () => {
        fetchCalls += 1;
        return _sseResponse(_terminalFrame(1));
      }) as unknown as typeof globalThis.fetch
    });
    try {
      await client.streamRun(_streamInput())[Symbol.asyncIterator]().next();
      throw new Error("Expected authorization resolution to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe("auth unavailable");
    }
    expect(fetchCalls).toBe(0);
  });

  test("stops and cancels observation immediately after runTerminal", async () => {
    const encoder = new TextEncoder();
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(_terminalFrame(1)));
      },
      cancel() {
        cancelled = true;
      }
    });
    const client = createAgentServerClient({
      baseUrl: "https://agent.example",
      authorization: "test-token",
      fetch: (async () => _sseResponse(body)) as unknown as typeof globalThis.fetch
    });
    const iterator = client.streamRun(_streamInput())[Symbol.asyncIterator]();
    expect(await iterator.next()).toMatchObject({
      done: false,
      value: { data: { type: "runTerminal" }, sequence: 1 }
    });
    expect(await iterator.next()).toEqual({ done: true, value: undefined });
    expect(cancelled).toBe(true);
  });
});

function _streamInput() {
  return {
    sessionId: "session-test",
    runId: "run-test",
    continuationToken: "continuation-test"
  };
}

function _terminalFrame(sequence: number): string {
  return `id: ${sequence}\nevent: control\ndata: {"type":"runTerminal","outcome":"completed"}\n\n`;
}

function _sseResponse(body: ReadableStream<Uint8Array> | string): Response {
  return new Response(body, {
    headers: { "content-type": "text/event-stream" }
  });
}

function _failedSseResponse(frame: string): Response {
  const encoder = new TextEncoder();
  let sent = false;
  return _sseResponse(new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!sent) {
        sent = true;
        controller.enqueue(encoder.encode(frame));
        return;
      }
      await new Promise(resolve => { setTimeout(resolve, 1); });
      controller.error(new TypeError("test transport failure"));
    }
  }));
}
