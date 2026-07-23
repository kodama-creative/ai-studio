import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "bun:test";

import type { AssistantMessage, UserMessage } from "@earendil-works/pi-ai";

import { ServerSessionRepository } from "../../src/repository/server-session-repository";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map(async root => rm(root, {
    force: true,
    recursive: true
  })));
});

test("recovers a completed provider operation from its durable transcript boundary", async () => {
  const root = await mkdtemp(join(tmpdir(), "llm-space-server-ledger-"));
  roots.push(root);
  const fingerprint = "a".repeat(64);
  const continuationToken = Buffer.alloc(32, 7).toString("base64url");
  const owner = {
    issuer: "test",
    principalId: "principal-one",
    principalType: "user" as const
  };
  const first = await ServerSessionRepository.open({
    artifactFingerprint: fingerprint,
    root
  });
  const created = await first.createSession({
    continuationToken,
    idempotencyKey: "session-one",
    owner
  });
  const userMessage: UserMessage = {
    role: "user",
    content: [{ type: "text", text: "hello" }],
    timestamp: 1
  };
  const run = await first.createRun({
    configuration: {
      id: "configuration-one",
      agentSnapshotFingerprint: fingerprint,
      contextFingerprint: "b".repeat(64),
      executionMode: "react",
      model: { provider: "fake", id: "fake-model" },
      toolConfigurationFingerprint: "c".repeat(64)
    },
    continuationToken,
    idempotencyKey: "run-one",
    inputText: "hello",
    owner,
    sessionId: created.sessionId,
    userMessage
  });
  const persistedAssistant = _assistant("persisted transcript bytes", 2);
  await first.replaceTranscript(created.sessionId, [
    userMessage,
    persistedAssistant
  ]);
  const started = await first.commit({
    sessionId: created.sessionId,
    expectedVersion: 1,
    mutations: [{
      type: "startOperation",
      runId: run.runId,
      stepId: `${run.runId}:step:1`,
      stepSequence: 1,
      transcriptMessageCount: 1,
      operationId: `${run.runId}:step:1:provider:fake`,
      kind: "provider",
      provider: "fake",
      requestFingerprint: "d".repeat(64)
    }]
  });
  const replayValue = {
    type: "providerMessage",
    message: _assistant("replayed provider bytes", 3)
  };
  const replayJson = JSON.stringify(_canonicalJson(replayValue));
  await first.commit({
    sessionId: created.sessionId,
    expectedVersion: started.version,
    mutations: [{
      type: "settleOperation",
      runId: run.runId,
      operationId: `${run.runId}:step:1:provider:fake`,
      requestFingerprint: "d".repeat(64),
      state: "completed",
      replay: {
        byteLength: Buffer.byteLength(replayJson),
        resultFingerprint: createHash("sha256").update(replayJson).digest("hex"),
        value: replayValue
      }
    }]
  });
  await first.close();

  const restarted = await ServerSessionRepository.open({
    artifactFingerprint: fingerprint,
    root
  });
  const recovered = restarted.recoverableRun(created.sessionId, run.runId);
  expect(recovered.transcript).toEqual([userMessage]);
  expect(recovered.transcript).not.toContainEqual(persistedAssistant);
  await restarted.close();
});

function _assistant(text: string, timestamp: number): AssistantMessage {
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

function _canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(_canonicalJson);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map(key => [
        key,
        _canonicalJson((value as Record<string, unknown>)[key])
      ])
    );
  }
  return value;
}
