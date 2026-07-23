import {
  InMemorySessionStore,
  type RuntimeRunConfigurationSnapshot,
  type StoredRuntimeSession
} from "@llm-space/runtime/harness";
import { expect, test } from "bun:test";

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Thread } from "@llm-space/core";

import { createDesktopThreadRuntimeAuthority } from "../../../src/bun/streaming/desktop-thread-runtime-authority";

test("keeps one Thread authority for transcript and Runtime operation recovery", async () => {
  const session = await _startedSession();
  let thread: Thread = {
    title: "Durable thread",
    model: { provider: "fake", id: "fake-model" },
    context: {
      messages: [{
        id: "user-one",
        role: "user",
        content: [{ type: "text", text: "hello" }]
      }],
      tools: [],
      systemPrompt: "Stay durable."
    },
    runtimeSession: session
  };
  const adapter = {
    read: async () => structuredClone(thread),
    write: async (next: Thread) => { thread = structuredClone(next); }
  };
  const authority = await createDesktopThreadRuntimeAuthority(adapter);
  const started = await authority.sessionStore.commit({
    sessionId: "session-one",
    expectedVersion: session.version,
    mutations: [{
      type: "startOperation",
      runId: "run-one",
      stepId: "run-one:step:1",
      stepSequence: 1,
      transcriptMessageCount: 1,
      operationId: "run-one:step:1:provider:fake",
      kind: "provider",
      provider: "fake",
      requestFingerprint: "a".repeat(64)
    }]
  });
  await authority.persistence.replaceMessages([
    _user("hello", 1),
    _assistant("same text may already exist", 2)
  ]);

  expect(thread).toMatchObject({
    title: "Durable thread",
    context: {
      systemPrompt: "Stay durable.",
      messages: [
        { id: "user-one", role: "user" },
        { role: "assistant" }
      ]
    },
    runtimeSession: {
      version: started.version,
      snapshot: {
        operationLedger: {
          steps: [{ transcriptMessageCount: 1 }]
        }
      }
    }
  });

  const restarted = await createDesktopThreadRuntimeAuthority(adapter);
  expect(restarted.reconcileInitialMessages([
    _user("hello", 3),
    _assistant("different bytes do not affect the boundary", 4)
  ])).toEqual([_user("hello", 3)]);
});

async function _startedSession(): Promise<StoredRuntimeSession> {
  const store = new InMemorySessionStore();
  const configuration: RuntimeRunConfigurationSnapshot = {
    id: "configuration-one",
    agentSnapshotFingerprint: "agent-one",
    contextFingerprint: "context-one",
    executionMode: "react",
    model: { provider: "fake", id: "fake-model" },
    toolConfigurationFingerprint: "tools-one"
  };
  return store.commit({
    sessionId: "session-one",
    expectedVersion: null,
    mutations: [{ type: "startRun", runId: "run-one", configuration }]
  });
}

function _user(text: string, timestamp: number): AgentMessage {
  return {
    role: "user",
    content: [{ type: "text", text }],
    timestamp
  };
}

function _assistant(text: string, timestamp: number): AgentMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "fake",
    provider: "fake",
    model: "fake-model",
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
    },
    stopReason: "stop",
    timestamp
  };
}
