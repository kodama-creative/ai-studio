import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runtimeHistoryMessages } from "@llm-space/runtime/harness";
import { afterEach, expect, test } from "bun:test";

import type { AssistantMessage, UserMessage } from "@earendil-works/pi-ai";

import {
  ServerIdempotencyConflictError,
  ServerSessionRepository
} from "../../src/repository/server-session-repository";

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

test("publishes a Runtime-owned limit terminal after repository restart", async () => {
  const root = await mkdtemp(join(tmpdir(), "llm-space-server-limit-terminal-"));
  roots.push(root);
  const artifactFingerprint = "a".repeat(64);
  const continuationToken = Buffer.alloc(32, 13).toString("base64url");
  const owner = {
    issuer: "test",
    principalId: "principal-one",
    principalType: "user" as const
  };
  const first = await ServerSessionRepository.open({
    artifactFingerprint,
    root
  });
  const created = await first.createSession({
    continuationToken,
    idempotencyKey: "limit-session",
    owner
  });
  const userMessage = _user("loop", 1);
  const run = await first.createRun({
    configuration: {
      ..._configuration("configuration-limit", artifactFingerprint),
      limits: { maxModelCallsPerRun: 1 }
    },
    continuationToken,
    idempotencyKey: "limit-run",
    inputText: "loop",
    owner,
    sessionId: created.sessionId,
    userMessage
  });
  const initial = await first.load(created.sessionId);
  if (!initial) { throw new Error("Expected Runtime Session"); }
  const checkpointed = await first.commit({
    sessionId: created.sessionId,
    expectedVersion: initial.version,
    mutations: [
      {
        type: "transitionRun",
        runId: run.runId,
        to: "runningTools"
      },
      {
        type: "transitionRun",
        runId: run.runId,
        to: "waitingForContinue"
      },
      {
        type: "recordCheckpoint",
        runId: run.runId,
        messages: [userMessage],
        continuationFingerprint: "waiting-boundary"
      }
    ]
  });
  const resumed = await first.commit({
    sessionId: created.sessionId,
    expectedVersion: checkpointed.version,
    mutations: [{
      type: "transitionRun",
      runId: run.runId,
      to: "runningModel"
    }]
  });
  const operationId = `${run.runId}:step:1:provider:fake`;
  const started = await first.commit({
    sessionId: created.sessionId,
    expectedVersion: resumed.version,
    mutations: [{
      type: "startOperation",
      runId: run.runId,
      stepId: `${run.runId}:step:1`,
      stepSequence: 1,
      transcriptMessageCount: 1,
      operationId,
      kind: "provider",
      provider: "fake",
      requestFingerprint: "d".repeat(64)
    }]
  });
  await first.commit({
    sessionId: created.sessionId,
    expectedVersion: started.version,
    mutations: [
      {
        type: "settleOperation",
        runId: run.runId,
        operationId,
        requestFingerprint: "d".repeat(64),
        state: "completed",
        replay: {
          byteLength: 4,
          resultFingerprint: createHash("sha256").update("null").digest("hex"),
          value: null
        }
      },
      {
        type: "transitionRun",
        runId: run.runId,
        to: "failed",
        failure: {
          axis: "modelCalls",
          attempted: 2,
          code: "runLimitExceeded",
          consumed: 1,
          limit: 1
        }
      }
    ]
  });
  expect(first.pendingRuntimeTerminals(created.sessionId)).toEqual([{
    code: "runLimitExceeded",
    outcome: "failed",
    runId: run.runId
  }]);
  await first.close();

  const restarted = await ServerSessionRepository.open({
    artifactFingerprint,
    root
  });
  const [pending] = restarted.pendingRuntimeTerminals(created.sessionId);
  if (!pending) { throw new Error("Expected pending Runtime terminal"); }
  const terminal = await restarted.completeRun({
    sessionId: created.sessionId,
    runId: pending.runId,
    outcome: pending.outcome,
    ...(pending.code ? { code: pending.code } : {})
  });

  expect(terminal).toMatchObject({
    data: {
      type: "runTerminal",
      code: "runLimitExceeded",
      outcome: "failed",
      runtime: {
        session: {
          snapshot: {
            runs: [{ failure: { consumed: 1, limit: 1 } }]
          }
        }
      }
    }
  });
  expect(restarted.pendingRuntimeTerminals(created.sessionId)).toEqual([]);
  await restarted.close();
});

test("forks from an authenticated working base and persists authoritative rename", async () => {
  const root = await mkdtemp(join(tmpdir(), "llm-space-server-branch-"));
  roots.push(root);
  const artifactFingerprint = "a".repeat(64);
  const continuationToken = Buffer.alloc(32, 9).toString("base64url");
  const owner = {
    issuer: "test",
    principalId: "principal-one",
    principalType: "user" as const
  };
  const repository = await ServerSessionRepository.open({
    artifactFingerprint,
    root
  });
  const created = await repository.createSession({
    continuationToken,
    idempotencyKey: "session-branch",
    owner
  });
  const firstUser = _user("first", 1);
  const firstAssistant = _assistant("first answer", 2);
  const first = await repository.createRun({
    configuration: _configuration("configuration-first", artifactFingerprint),
    continuationToken,
    idempotencyKey: "run-first",
    inputText: "first",
    owner,
    sessionId: created.sessionId,
    userMessage: firstUser
  });
  await repository.replaceTranscript(created.sessionId, [
    firstUser,
    firstAssistant
  ]);
  const firstTerminal = await repository.completeRun({
    outcome: "completed",
    runId: first.runId,
    sessionId: created.sessionId
  });
  const firstRuntime = (firstTerminal.data as {
    runtime?: { branchId: string; checkpointId: string; };
  }).runtime;
  expect(firstRuntime).toEqual({
    branchId: "branch-1",
    checkpointId: `${first.runId}:checkpoint:1`,
    session: expect.any(Object)
  });

  const secondUser = _user("second", 3);
  const secondAssistant = _assistant("second answer", 4);
  const second = await repository.createRun({
    configuration: _configuration("configuration-second", artifactFingerprint),
    continuationToken,
    idempotencyKey: "run-second",
    inputText: "second",
    owner,
    sessionId: created.sessionId,
    userMessage: secondUser
  });
  await repository.replaceTranscript(created.sessionId, [
    firstUser,
    firstAssistant,
    secondUser,
    secondAssistant
  ]);
  await repository.completeRun({
    outcome: "completed",
    runId: second.runId,
    sessionId: created.sessionId
  });

  const forkUser = _user("fork", 5);
  const fork = await repository.createRun({
    configuration: _configuration("configuration-fork", artifactFingerprint),
    continuationToken,
    idempotencyKey: "run-fork",
    inputText: "fork",
    owner,
    sessionId: created.sessionId,
    userMessage: forkUser,
    workingBase: {
      branchId: "branch-1",
      checkpointId: `${first.runId}:checkpoint:1`
    }
  });
  const forked = await repository.load(created.sessionId);
  const forkRun = forked?.snapshot.runs.find(run => run.id === fork.runId);
  expect(forkRun).toMatchObject({
    branchId: "branch-2",
    baseCheckpointId: `${first.runId}:checkpoint:1`
  });
  expect(runtimeHistoryMessages(
    forked!.snapshot.history,
    forkRun!.inputHeadEntryId
  )).toEqual([firstUser, firstAssistant, forkUser]);
  const idempotentFork = await repository.findIdempotentRun({
    continuationToken,
    idempotencyKey: "run-fork",
    inputText: "fork",
    owner,
    sessionId: created.sessionId,
    workingBase: {
      branchId: "branch-1",
      checkpointId: `${first.runId}:checkpoint:1`
    }
  });
  expect(idempotentFork).toMatchObject({
    created: false,
    runId: fork.runId
  });
  expect(repository.findIdempotentRun({
    continuationToken,
    idempotencyKey: "run-fork",
    inputText: "fork",
    owner,
    sessionId: created.sessionId,
    workingBase: {
      branchId: "branch-1",
      checkpointId: `${second.runId}:checkpoint:1`
    }
  })).rejects.toBeInstanceOf(ServerIdempotencyConflictError);

  await repository.renameBranch({
    branchId: "branch-2",
    continuationToken,
    label: "Investigation",
    owner,
    sessionId: created.sessionId
  });
  await repository.close();
  const restarted = await ServerSessionRepository.open({
    artifactFingerprint,
    root
  });
  expect((await restarted.load(created.sessionId))?.snapshot.history.branches)
    .toContainEqual(expect.objectContaining({
      id: "branch-2",
      label: "Investigation"
    }));
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

function _user(text: string, timestamp: number): UserMessage {
  return {
    role: "user",
    content: [{ type: "text", text }],
    timestamp
  };
}

function _configuration(id: string, artifactFingerprint: string) {
  return {
    id,
    agentSnapshotFingerprint: artifactFingerprint,
    contextFingerprint: "b".repeat(64),
    executionMode: "react" as const,
    model: { provider: "fake", id: "fake-model" },
    toolConfigurationFingerprint: "c".repeat(64)
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
