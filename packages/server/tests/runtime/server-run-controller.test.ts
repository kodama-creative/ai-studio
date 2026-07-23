import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAssistantMessageEventStream,
  createModels,
  createProvider,
  type Model
} from "@earendil-works/pi-ai";
import { recoverRuntimeSession } from "@llm-space/runtime/harness";
import { afterEach, expect, test } from "bun:test";

import type { CompiledAgentProjectSnapshot } from "@llm-space/runtime/server";

import { ServerSessionRepository } from "../../src/repository/server-session-repository";
import { ServerRunController } from "../../src/runtime/server-run-controller";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map(async root => rm(root, {
    force: true,
    recursive: true
  })));
});

test("replays a completed provider after Server controller restart", async () => {
  const root = await mkdtemp(join(tmpdir(), "llm-space-server-replay-"));
  roots.push(root);
  const fingerprint = "a".repeat(64);
  const continuationToken = Buffer.alloc(32, 9).toString("base64url");
  const owner = {
    issuer: "test",
    principalId: "principal-one",
    principalType: "user" as const
  };
  let providerDispatches = 0;
  const models = _models(() => { providerDispatches += 1; });
  const first = await ServerSessionRepository.open({
    artifactFingerprint: fingerprint,
    root
  });
  const created = await first.createSession({
    continuationToken,
    idempotencyKey: "session-one",
    owner
  });

  let releaseCompletion!: () => void;
  const completionBarrier = new Promise<void>(resolve => {
    releaseCompletion = resolve;
  });
  let observeCompletion!: () => void;
  const completionPersisted = new Promise<void>(resolve => {
    observeCompletion = resolve;
  });
  const originalCommit = first.commit.bind(first);
  first.commit = async input => {
    const committed = await originalCommit(input);
    if (input.mutations.some(mutation =>
      mutation.type === "settleOperation"
      && mutation.state === "completed")) {
      observeCompletion();
      await completionBarrier;
    }
    return committed;
  };
  const firstController = new ServerRunController({
    models,
    project: _project(fingerprint),
    repository: first
  });
  const run = await firstController.createRun({
    continuationToken,
    idempotencyKey: "run-one",
    owner,
    sessionId: created.sessionId,
    text: "hello"
  });
  await completionPersisted;
  const sessionPath = join(root, `${created.sessionId}.json`);
  const crashSnapshot = await readFile(sessionPath, "utf8");
  firstController.detach();
  releaseCompletion();
  await firstController.waitForIdle();
  await first.close();
  await writeFile(sessionPath, crashSnapshot, "utf8");

  const restarted = await ServerSessionRepository.open({
    artifactFingerprint: fingerprint,
    root
  });
  const recovery = await recoverRuntimeSession(restarted, created.sessionId);
  expect(recovery).toMatchObject({
    status: "operationReplay",
    run: { id: run.runId }
  });
  const restartedController = new ServerRunController({
    models,
    project: _project(fingerprint),
    repository: restarted
  });
  restartedController.resumeRun(restarted.recoverableRun(
    created.sessionId,
    run.runId
  ));
  await restartedController.waitForIdle();

  expect(providerDispatches).toBe(1);
  expect(await restarted.runTerminal({
    continuationToken,
    owner,
    runId: run.runId,
    sessionId: created.sessionId
  })).toBe("completed");
  await restarted.close();
});

function _models(onStream: () => void) {
  const model: Model<"fake"> = {
    id: "fake-model",
    name: "Fake Model",
    api: "fake",
    provider: "fake",
    baseUrl: "http://localhost.invalid",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 4_096
  };
  const models = createModels();
  models.setProvider(createProvider({
    id: "fake",
    auth: {
      apiKey: {
        name: "Fake",
        resolve: async () => Promise.resolve({ auth: {} })
      }
    },
    models: [model],
    api: {
      stream: () => _completedStream(onStream),
      streamSimple: () => _completedStream(onStream)
    }
  }));
  return models;
}

function _completedStream(onStream: () => void) {
  onStream();
  const stream = createAssistantMessageEventStream();
  const message = {
    role: "assistant" as const,
    content: [{ type: "text" as const, text: "done" }],
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
    stopReason: "stop" as const,
    timestamp: 1
  };
  queueMicrotask(() => {
    stream.push({ type: "start", partial: message });
    stream.push({ type: "done", reason: "stop", message });
  });
  return stream;
}

function _project(fingerprint: string): CompiledAgentProjectSnapshot {
  const section = { fingerprint, entries: [] };
  return {
    artifact: {
      schemaVersion: 1,
      fingerprint,
      fingerprints: {
        sources: section,
        dependencies: section,
        capabilities: section,
        schemas: section,
        runtime: section,
        environmentRequirements: section
      }
    },
    root: "/test-agent",
    definition: { model: { provider: "fake", id: "fake-model" } },
    instructions: "Answer briefly.",
    tools: [],
    connections: [],
    resources: { skills: [] },
    diagnostics: [],
    fingerprint
  };
}
