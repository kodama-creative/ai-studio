import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type Api,
  type AssistantMessage,
  type Context,
  createAssistantMessageEventStream,
  createModels,
  createProvider,
  type Model
} from "@earendil-works/pi-ai";
import {
  decideRuntimeToolApproval,
  recoverRuntimeSession
} from "@llm-space/runtime/harness";
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

test("runs a declared Subagent with a durable child Session", async () => {
  const root = await mkdtemp(join(tmpdir(), "llm-space-server-subagent-run-"));
  roots.push(root);
  const fingerprint = "a".repeat(64);
  const continuationToken = Buffer.alloc(32, 8).toString("base64url");
  const owner = {
    issuer: "test",
    principalId: "principal-one",
    principalType: "user" as const
  };
  const repository = await ServerSessionRepository.open({
    artifactFingerprint: fingerprint,
    root
  });
  const created = await repository.createSession({
    continuationToken,
    idempotencyKey: "session-subagent",
    owner
  });
  const controller = new ServerRunController({
    models: _subagentModels(),
    project: _subagentProject(fingerprint),
    repository
  });

  const run = await controller.createRun({
    continuationToken,
    idempotencyKey: "run-subagent",
    owner,
    sessionId: created.sessionId,
    text: "research"
  });
  await controller.waitForIdle();

  expect(await repository.runTerminal({
    continuationToken,
    owner,
    runId: run.runId,
    sessionId: created.sessionId
  })).toBe("completed");
  expect(repository.subagentRuns(created.sessionId)).toEqual([
    expect.objectContaining({
      message: "Research this bounded task.",
      status: "completed",
      subagentId: "researcher",
      terminal: { status: "completed", result: "child result" },
      transcript: [expect.objectContaining({ role: "user" }), expect.objectContaining({
        role: "assistant"
      })]
    })
  ]);
  const envelope = JSON.parse(
    await readFile(join(root, `${created.sessionId}.json`), "utf8")
  ) as {
    events: Record<string, Array<{
      data?: { runtime?: { subagents?: unknown[]; }; };
    }>>;
  };
  expect(envelope.events[run.runId]?.at(-1)?.data?.runtime?.subagents)
    .toEqual([expect.objectContaining({
      status: "completed",
      subagentId: "researcher",
      terminal: { status: "completed", result: "child result" }
    })]);
  await repository.close();
});

test("resumes the same child after a child-owned approval", async () => {
  const root = await mkdtemp(join(tmpdir(), "llm-space-server-subagent-wait-"));
  roots.push(root);
  const fingerprint = "a".repeat(64);
  const continuationToken = Buffer.alloc(32, 6).toString("base64url");
  const owner = {
    issuer: "test",
    principalId: "principal-one",
    principalType: "user" as const
  };
  let executions = 0;
  const repository = await ServerSessionRepository.open({
    artifactFingerprint: fingerprint,
    root
  });
  const created = await repository.createSession({
    continuationToken,
    idempotencyKey: "session-subagent-wait",
    owner
  });
  const project = _subagentProject(fingerprint, () => { executions += 1; });
  const controller = new ServerRunController({
    models: _subagentModels(true),
    project,
    repository
  });
  const run = await controller.createRun({
    continuationToken,
    idempotencyKey: "run-subagent-wait",
    owner,
    sessionId: created.sessionId,
    text: "research with approval"
  });
  await controller.waitForIdle();
  const child = repository.subagentRunForParent(created.sessionId, run.runId);
  const request = child?.runtime.snapshot.approvalLedger?.requests[0];
  if (!child || !request) { throw new Error("Expected child approval wait"); }
  expect({
    executions,
    status: child.status,
    terminal: await repository.runTerminal({
      continuationToken,
      owner,
      runId: run.runId,
      sessionId: created.sessionId
    })
  }).toEqual({ executions: 0, status: "waitingForApproval", terminal: null });
  const current = await repository.load(child.child.sessionId);
  if (!current) { throw new Error("Expected child Runtime Session"); }
  await decideRuntimeToolApproval(repository, {
    actor: { current: owner, initiator: owner },
    decision: "approved",
    expectedVersion: current.version,
    requestId: request.id,
    runId: child.child.runId,
    sessionId: child.child.sessionId
  });

  controller.resumeRun(repository.recoverableRun(created.sessionId, run.runId));
  await controller.waitForIdle();

  expect({
    executions,
    child: repository.subagentRunForParent(created.sessionId, run.runId),
    terminal: await repository.runTerminal({
      continuationToken,
      owner,
      runId: run.runId,
      sessionId: created.sessionId
    })
  }).toMatchObject({
    executions: 1,
    child: {
      child: child.child,
      status: "completed",
      terminal: { status: "completed", result: "child result" }
    },
    terminal: "completed"
  });
  await repository.close();
});

test("applies the Server Host approval policy to child tools", async () => {
  const root = await mkdtemp(join(tmpdir(), "llm-space-server-subagent-policy-"));
  roots.push(root);
  const fingerprint = "a".repeat(64);
  const continuationToken = Buffer.alloc(32, 5).toString("base64url");
  const owner = {
    issuer: "test",
    principalId: "principal-one",
    principalType: "user" as const
  };
  let executions = 0;
  const repository = await ServerSessionRepository.open({
    artifactFingerprint: fingerprint,
    root
  });
  const created = await repository.createSession({
    continuationToken,
    idempotencyKey: "session-subagent-host-policy",
    owner
  });
  const controller = new ServerRunController({
    approvalPolicy: {
      id: "server-host-always-v1",
      evaluate: context => (context.toolName === "approval_action"
        ? "always"
        : "never")
    },
    models: _subagentModels(true),
    project: _subagentProject(
      fingerprint,
      () => { executions += 1; },
      "never"
    ),
    repository
  });

  const run = await controller.createRun({
    continuationToken,
    idempotencyKey: "run-subagent-host-policy",
    owner,
    sessionId: created.sessionId,
    text: "research under Host policy"
  });
  await controller.waitForIdle();

  expect({
    executions,
    child: repository.subagentRunForParent(created.sessionId, run.runId),
    terminal: await repository.runTerminal({
      continuationToken,
      owner,
      runId: run.runId,
      sessionId: created.sessionId
    })
  }).toMatchObject({
    executions: 0,
    child: { status: "waitingForApproval" },
    terminal: null
  });
  await repository.close();
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

function _subagentModels(childApproval = false) {
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
  const stream = (_model: Model<Api>, context: Context) => {
    const events = createAssistantMessageEventStream();
    const child = context.systemPrompt === "Child instructions.";
    const hasResult = context.messages.at(-1)?.role === "toolResult";
    const content: AssistantMessage["content"] = child
      ? childApproval && !hasResult
        ? [{
          type: "toolCall",
          id: "call-approval-action",
          name: "approval_action",
          arguments: {}
        }]
        : [{ type: "text", text: "child result" }]
      : hasResult
        ? [{ type: "text", text: "parent result" }]
        : [{
          type: "toolCall",
          id: "call-researcher",
          name: "researcher",
          arguments: { message: "Research this bounded task." }
        }];
    const message: AssistantMessage = {
      role: "assistant",
      content,
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
      stopReason: (child && (!childApproval || hasResult)) || hasResult
        ? "stop"
        : "toolUse",
      timestamp: Date.now()
    };
    queueMicrotask(() => {
      events.push({ type: "start", partial: message });
      events.push({
        type: "done",
        reason: (child && (!childApproval || hasResult)) || hasResult
          ? "stop"
          : "toolUse",
        message
      });
    });
    return events;
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
    api: { stream, streamSimple: stream }
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

function _subagentProject(
  fingerprint: string,
  onApprovalExecute?: () => void,
  childApproval: "always" | "never" = "always"
): CompiledAgentProjectSnapshot {
  const root = _project(fingerprint);
  const childFingerprint = "b".repeat(64);
  const childSection = { fingerprint: childFingerprint, entries: [] };
  return {
    ...root,
    subagents: [{
      id: "researcher",
      description: "Research one bounded question.",
      project: {
        ...root,
        root: "/test-agent/subagents/researcher",
        definition: {
          description: "Research one bounded question.",
          limits: { maxModelCallsPerRun: 25 },
          model: { provider: "fake", id: "fake-model" }
        },
        instructions: "Child instructions.",
        tools: onApprovalExecute
          ? [{
            name: "approval_action",
            label: "approval_action",
            description: "Run one approval-bound action.",
            parameters: { type: "object", properties: {} },
            approval: childApproval,
            async execute() {
              onApprovalExecute();
              return {
                content: [{ type: "text" as const, text: "approved" }],
                details: {}
              };
            }
          }]
          : [],
        fingerprint: childFingerprint,
        artifact: {
          schemaVersion: 1,
          fingerprint: childFingerprint,
          fingerprints: {
            sources: childSection,
            dependencies: childSection,
            capabilities: childSection,
            schemas: childSection,
            runtime: childSection,
            environmentRequirements: childSection
          }
        }
      }
    }]
  };
}
