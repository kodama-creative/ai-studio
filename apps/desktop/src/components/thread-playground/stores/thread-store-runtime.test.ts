import { InMemorySessionStore } from "@llm-space/runtime/harness";
import { describe, expect, mock, test } from "bun:test";

import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { AgentEvent, AgentTransport, Thread } from "@llm-space/core";
import type { StoredRuntimeSession } from "@llm-space/runtime/harness";

import { ThreadRuntimeSession } from "./thread-runtime-session";

void mock.module("@/lib/electrobun", () => ({ electrobun: { rpc: null } }));
globalThis.requestAnimationFrame = callback =>
  setTimeout(() => { callback(performance.now()); }, 0) as unknown as number;
globalThis.cancelAnimationFrame = handle => {
  clearTimeout(handle);
};

describe("Thread store Runtime Harness integration", () => {
  test("projects a transport-owned Server Run without creating Desktop authority", async () => {
    const { createThreadStore } = await import("./thread-store");
    let persisted: Thread = {
      ..._initialThread(),
      runtimeProfile: {
        version: 1,
        type: "localServer",
        artifactFingerprint: "artifact-one",
        serverSessionId: "session-server"
      }
    };
    const store = createThreadStore(persisted, {
      transport: _finalTransport(),
      resolveModel: saved => saved ?? null,
      runtimeOwnsToolLoop: true,
      transportOwnsRuntimeRun: true,
      resolveTransportRuntimeCheckpoint: () => ({
        runId: "run-server",
        state: "completed",
        checkpointOrder: 1,
        continuationFingerprint:
          "local-server:artifact-one:session-server:run-server",
        server: {
          profile: "localServer",
          artifactFingerprint: "artifact-one",
          sessionId: "session-server",
          runId: "run-server"
        }
      }),
      persistSettledThread: async thread => {
        persisted = structuredClone(thread);
      }
    });

    await store.getState().run();

    expect(persisted.runtimeSession).toBeUndefined();
    expect(persisted.runtimeProfile).toMatchObject({
      type: "localServer",
      serverSessionId: "session-server"
    });
    expect(persisted.runHistory).toHaveLength(1);
    expect(persisted.runHistory?.[0]?.runtime).toMatchObject({
      runId: "run-server",
      state: "completed",
      server: {
        artifactFingerprint: "artifact-one",
        sessionId: "session-server",
        runId: "run-server"
      }
    });
  });

  test("does not reuse a prior Turn's structured output for a later text Run", async () => {
    const { createThreadStore } = await import("./thread-store");
    let persisted: Thread = {
      ..._initialThread(),
      context: {
        messages: [
          {
            id: "user-one",
            role: "user",
            content: [{ type: "text", text: "Return a contact" }]
          },
          {
            id: "assistant-one",
            role: "assistant",
            content: [],
            toolCalls: [{
              id: "final-one",
              input: { name: "final_output", arguments: { name: "Ada" } },
              output: {
                content: [{ type: "text", text: "{\"name\":\"Ada\"}" }],
                details: {
                  structuredOutput: {
                    contract: "contact-card",
                    schemaFingerprint: "a".repeat(64),
                    value: { name: "Ada" }
                  }
                }
              }
            }]
          },
          {
            id: "user-two",
            role: "user",
            content: [{ type: "text", text: "Reply in text" }]
          }
        ]
      }
    };
    const store = createThreadStore(persisted, {
      transport: _finalTransport(),
      resolveModel: saved => saved ?? null,
      runtimeOwnsToolLoop: true,
      persistSettledThread: async thread => {
        persisted = structuredClone(thread);
      }
    });

    await store.getState().run();

    expect(persisted.runHistory?.at(-1)?.structuredOutput).toBeUndefined();
    expect(
      (persisted.runtimeSession as StoredRuntimeSession).snapshot.runs.at(-1)
    ).toMatchObject({ state: "completed" });
  });

  test("persists a manual wait and reloads the same Run for prompt-free continuation", async () => {
    const { createThreadStore } = await import("./thread-store");
    let persisted: Thread = _initialThread();
    const first = createThreadStore(persisted, {
      transport: _transport(),
      resolveModel: saved => saved ?? null,
      getAutoRunTools: () => false,
      getReactLoop: () => false,
      runtimeOwnsToolLoop: true,
      persistSettledThread: async thread => {
        persisted = structuredClone(thread);
      }
    });

    await first.getState().run();

    const firstCheckpoint = persisted.runHistory?.[0];
    expect(firstCheckpoint?.runtime?.state).toBe("waitingForToolResults");
    expect(
      (persisted.runtimeSession as StoredRuntimeSession).snapshot.activeRunId
    ).toBe(firstCheckpoint?.runtime?.runId ?? null);

    const reloaded = createThreadStore(persisted, {
      transport: _transport(),
      resolveModel: saved => saved ?? null,
      getAutoRunTools: () => false,
      getReactLoop: () => false,
      runtimeOwnsToolLoop: true,
      persistSettledThread: async thread => {
        persisted = structuredClone(thread);
      }
    });
    const removableCheckpoint = reloaded.getState().runHistory[0];
    if (!removableCheckpoint) {
      throw new Error("Expected a removable Runtime checkpoint");
    }
    reloaded.getState().removeRun(removableCheckpoint);
    const assistantId = persisted.context?.messages?.find(
      message => message.role === "assistant"
    )?.id;
    if (!assistantId) {
      throw new Error("Expected a persisted assistant tool call");
    }
    reloaded.getState().updateToolCallOutputTextContent(
      assistantId,
      "call-one",
      "sunny"
    );
    await reloaded.getState().run();

    expect(persisted.runHistory).toHaveLength(1);
    expect(persisted.runHistory?.[0]?.runtime?.runId).toBe(
      firstCheckpoint?.runtime?.runId
    );
    expect(persisted.runHistory?.at(-1)?.runtime).toMatchObject({
      state: "completed",
      checkpointOrder: 2
    });
    expect(
      persisted.context?.messages?.filter(message => message.role === "user")
    ).toHaveLength(1);
    const session = persisted.runtimeSession as StoredRuntimeSession;
    expect(session.snapshot.runs).toHaveLength(1);
    expect(session.snapshot.runs[0]?.state).toBe("completed");
  });

  test("adopts a Bun-committed state snapshot before renderer settlement", async () => {
    const { createThreadStore } = await import("./thread-store");
    let persisted: Thread = _initialThread();
    let committed: StoredRuntimeSession | undefined;
    const baseTransport = _finalTransport();
    const transport: AgentTransport = async function* transport(request, options) {
      const begun = persisted.runtimeSession as StoredRuntimeSession;
      const memory = new InMemorySessionStore([begun]);
      committed = await memory.commit({
        sessionId: begun.snapshot.id,
        expectedVersion: begun.version,
        mutations: [{
          type: "replaceState",
          values: {
            "desktop.counter": {
              definitionVersion: 1,
              schemaFingerprint: "desktop-counter-v1",
              value: { count: 1 }
            }
          }
        }]
      });
      for await (const event of baseTransport(request, options)) {
        yield event;
      }
    };
    const store = createThreadStore(persisted, {
      transport,
      resolveModel: saved => saved ?? null,
      runtimeOwnsToolLoop: true,
      resolveCommittedRuntimeSession: () => committed,
      persistSettledThread: async thread => {
        persisted = structuredClone(thread);
      }
    });

    await store.getState().run();

    const final = persisted.runtimeSession as StoredRuntimeSession;
    expect(final.version).toBe((committed?.version ?? 0) + 1);
    expect(final.snapshot.state?.values["desktop.counter"]?.value)
      .toEqual({ count: 1 });
    expect(final.snapshot.runs[0]?.state).toBe("completed");
  });

  test("persists outcome unknown before refusing to replay interrupted work", async () => {
    const { createThreadStore } = await import("./thread-store");
    let persisted: Thread = _initialThread();
    const interrupted = new ThreadRuntimeSession(undefined);
    const begun = await interrupted.begin({
      thread: persisted,
      context: persisted.context ?? {},
      executionMode: "react",
      model: persisted.model!
    });
    persisted = { ...persisted, runtimeSession: begun.session };
    let transportCalls = 0;
    const interruptedTransport = _transport();
    const store = createThreadStore(persisted, {
      transport: (...args) => {
        transportCalls += 1;
        return interruptedTransport(...args);
      },
      resolveModel: saved => saved ?? null,
      getAutoRunTools: () => true,
      getReactLoop: () => true,
      runtimeOwnsToolLoop: true,
      persistSettledThread: async thread => {
        persisted = structuredClone(thread);
      }
    });

    await store.getState().run();

    expect(transportCalls).toBe(0);
    expect(persisted.runtimeSession).toMatchObject({
      snapshot: {
        activeRunId: null,
        runs: [{ id: begun.runId, state: "outcomeUnknown" }]
      }
    });
    expect(persisted.runHistory ?? []).toHaveLength(0);
  });

  test("settles a state commit transport failure as outcome unknown", async () => {
    const { createThreadStore } = await import("./thread-store");
    let persisted: Thread = _initialThread();
    const transport: AgentTransport = async function* transport() {
      yield* [] as AgentEvent[];
      const error = new Error("State commit could not be confirmed");
      error.name = "RuntimeOutcomeUnknownError";
      throw error;
    };
    const store = createThreadStore(persisted, {
      transport,
      resolveModel: saved => saved ?? null,
      runtimeOwnsToolLoop: true,
      persistSettledThread: async thread => {
        persisted = structuredClone(thread);
      }
    });

    await store.getState().run();

    expect(persisted.runtimeSession).toMatchObject({
      snapshot: {
        activeRunId: null,
        runs: [{ state: "outcomeUnknown" }]
      }
    });
  });

  test("does not publish recovered state when durable persistence fails", async () => {
    const { createThreadStore } = await import("./thread-store");
    const persisted = _initialThread();
    const interrupted = new ThreadRuntimeSession(undefined);
    const begun = await interrupted.begin({
      thread: persisted,
      context: persisted.context ?? {},
      executionMode: "react",
      model: persisted.model!
    });
    const interruptedThread = {
      ...persisted,
      runtimeSession: begun.session
    };
    let transportCalls = 0;
    const interruptedTransport = _transport();
    const store = createThreadStore(interruptedThread, {
      transport: (...args) => {
        transportCalls += 1;
        return interruptedTransport(...args);
      },
      resolveModel: saved => saved ?? null,
      getAutoRunTools: () => true,
      getReactLoop: () => true,
      runtimeOwnsToolLoop: true,
      persistSettledThread: async () => {
        throw new Error("fixture write failed");
      }
    });

    await store.getState().run();

    expect(transportCalls).toBe(0);
    expect(store.getState().thread.runtimeSession).toEqual(begun.session);
  });
});

function _initialThread(): Thread {
  return {
    model: { provider: "fake", id: "model" },
    context: {
      tools: [
        {
          type: "function" as const,
          name: "weather",
          description: "Get weather",
          parameters: { type: "object", properties: {} }
        }
      ],
      messages: [
        {
          id: "user-one",
          role: "user" as const,
          content: [{ type: "text" as const, text: "Weather?" }]
        }
      ]
    }
  };
}

function _transport(): AgentTransport {
  return async function* transport(
    request
  ): AsyncGenerator<AgentEvent> {
    const hasToolResult = request.context.messages.at(-1)?.role === "toolResult";
    const assistant = hasToolResult ? _finalAssistant() : _toolAssistant();
    yield { type: "message_start", message: assistant };
    if (!hasToolResult) {
      yield {
        type: "message_update",
        message: assistant,
        assistantMessageEvent: {
          type: "toolcall_start",
          contentIndex: 0,
          partial: assistant
        }
      };
      yield {
        type: "message_update",
        message: assistant,
        assistantMessageEvent: {
          type: "toolcall_end",
          contentIndex: 0,
          toolCall: {
            type: "toolCall",
            id: "call-one",
            name: "weather",
            arguments: {}
          },
          partial: assistant
        }
      };
    }
    yield { type: "message_end", message: assistant };
    yield { type: "agent_end", messages: [...request.context.messages, assistant] };
  };
}

function _finalTransport(): AgentTransport {
  return async function* transport(request): AsyncGenerator<AgentEvent> {
    const assistant = _finalAssistant();
    yield { type: "message_start", message: assistant };
    yield { type: "message_end", message: assistant };
    yield {
      type: "agent_end",
      messages: [...request.context.messages, assistant]
    };
  };
}

function _toolAssistant(): AssistantMessage {
  return _assistant([
    {
      type: "toolCall",
      id: "call-one",
      name: "weather",
      arguments: {}
    }
  ], "toolUse");
}

function _finalAssistant(): AssistantMessage {
  return _assistant([{ type: "text", text: "Done" }], "stop");
}

function _assistant(
  content: AssistantMessage["content"],
  stopReason: AssistantMessage["stopReason"]
): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: "fake",
    provider: "fake",
    model: "model",
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
    },
    stopReason,
    timestamp: Date.now()
  };
}
