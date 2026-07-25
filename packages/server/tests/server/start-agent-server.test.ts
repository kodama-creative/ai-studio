import { mkdtemp, rm } from "node:fs/promises";
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
  type AgentServerStreamEvent,
  createAgentServerClient
} from "@llm-space/runtime/client";
import { afterEach, describe, expect, test } from "bun:test";

import type { CompiledAgentProjectSnapshot } from "@llm-space/runtime/node";

import { createStaticBearerAuthenticator } from "../../src/auth/server-authenticator";
import {
  startAgentServer,
  type StartedAgentServer
} from "../../src/server/start-agent-server";

const AUTH_TOKEN = "auth-token-with-at-least-thirty-two-bytes";
const OTHER_AUTH_TOKEN = "second-auth-token-with-at-least-thirty-two";
const ROOTS: string[] = [];
const SERVERS: StartedAgentServer[] = [];

afterEach(async () => {
  await Promise.all(SERVERS.splice(0).map(async server => server.stop()));
  await Promise.all(ROOTS.splice(0).map(async root => rm(root, {
    force: true,
    recursive: true
  })));
});

describe("protected Session budget decisions", () => {
  test("keeps the wait open and resumes the same Run once", async () => {
    const root = await _root();
    let providerCalls = 0;
    const server = await _server(root, () => { providerCalls += 1; });
    SERVERS.push(server);
    const client = _client(server);
    const session = await client.createSession({
      continuationToken: _continuationToken(51),
      idempotencyKey: "budget-session"
    });
    const run = await client.createRun({
      sessionId: session.sessionId,
      continuationToken: session.continuationToken,
      idempotencyKey: "budget-run",
      text: "budget"
    });
    const iterator = client.streamRun({
      sessionId: session.sessionId,
      runId: run.runId,
      continuationToken: session.continuationToken
    })[Symbol.asyncIterator]();
    const events: AgentServerStreamEvent[] = [];
    let budgetWaitId = "";
    while (!budgetWaitId) {
      const next = await iterator.next();
      expect(next.done).toBe(false);
      const value = next.value as AgentServerStreamEvent;
      events.push(value);
      if (
        value.event === "control"
        && value.data.type === "sessionBudgetRequired"
      ) {
        budgetWaitId = value.data.budget.id;
        expect(value.data.budget.runId).toBe(run.runId);
        expect(value.data.session.snapshot.runs.at(-1)?.state)
          .toBe("waitingForBudget");
      }
    }
    expect(providerCalls).toBe(1);
    const pendingNext = iterator.next();
    expect(await Promise.race([
      pendingNext.then(() => "event"),
      Bun.sleep(30).then(() => "waiting")
    ])).toBe("waiting");

    const granted = await client.decideSessionBudget({
      continuationToken: session.continuationToken,
      decision: "freshWindow",
      runId: run.runId,
      sessionId: session.sessionId
    });
    expect(granted.status).toBe("resuming");
    expect(granted.session.snapshot.runs.at(-1)).toMatchObject({
      id: run.runId,
      state: "runningModel"
    });
    expect(granted.session.snapshot.budget?.waits.at(-1)).toMatchObject({
      id: budgetWaitId,
      status: "granted"
    });
    const resumed = await pendingNext;
    if (!resumed.done) { events.push(resumed.value); }
    for await (const event of { [Symbol.asyncIterator]: () => iterator }) {
      events.push(event);
    }
    expect(providerCalls).toBe(2);
    expect(events.at(-1)).toMatchObject({
      event: "control",
      data: { type: "runTerminal", outcome: "completed" }
    });
  }, 15_000);

  test("restores a wait and hides Stop from another principal", async () => {
    const root = await _root();
    let providerCalls = 0;
    const countProvider = () => { providerCalls += 1; };
    const first = await _server(root, countProvider);
    const firstClient = _client(first);
    const session = await firstClient.createSession({
      continuationToken: _continuationToken(52),
      idempotencyKey: "budget-restart-session"
    });
    const run = await firstClient.createRun({
      sessionId: session.sessionId,
      continuationToken: session.continuationToken,
      idempotencyKey: "budget-restart-run",
      text: "budget"
    });
    const firstIterator = firstClient.streamRun({
      sessionId: session.sessionId,
      runId: run.runId,
      continuationToken: session.continuationToken
    })[Symbol.asyncIterator]();
    await _waitForBudget(firstIterator);
    expect(providerCalls).toBe(1);
    await firstIterator.return?.();
    await first.stop();

    const restarted = await _server(root, countProvider);
    SERVERS.push(restarted);
    const client = _client(restarted);
    const iterator = client.streamRun({
      sessionId: session.sessionId,
      runId: run.runId,
      continuationToken: session.continuationToken
    })[Symbol.asyncIterator]();
    await _waitForBudget(iterator);
    await Bun.sleep(30);
    expect(providerCalls).toBe(1);

    const hidden = await fetch(
      `${restarted.url}/v1/sessions/${session.sessionId}/runs/${run.runId}/budget`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${OTHER_AUTH_TOKEN}`,
          "content-type": "application/json",
          "llm-space-continuation": session.continuationToken
        },
        body: JSON.stringify({ decision: "stop" })
      }
    );
    expect(hidden.status).toBe(404);
    const stopped = await client.decideSessionBudget({
      continuationToken: session.continuationToken,
      decision: "stop",
      runId: run.runId,
      sessionId: session.sessionId
    });
    expect(stopped.status).toBe("stopped");
    expect(stopped.session.snapshot.runs.at(-1)?.state).toBe("cancelled");
    const remaining: AgentServerStreamEvent[] = [];
    for await (const event of { [Symbol.asyncIterator]: () => iterator }) {
      remaining.push(event);
    }
    expect(remaining.at(-1)).toMatchObject({
      event: "control",
      data: { type: "runTerminal", outcome: "cancelled" }
    });
    expect(providerCalls).toBe(1);
  }, 15_000);
});

async function _waitForBudget(
  iterator: AsyncIterator<AgentServerStreamEvent>
): Promise<void> {
  while (true) {
    const next = await iterator.next();
    if (next.done) { throw new Error("Run ended before its budget wait"); }
    if (
      next.value.event === "control"
      && next.value.data.type === "sessionBudgetRequired"
    ) {
      return;
    }
  }
}

async function _root(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "llm-space-server-budget-"));
  ROOTS.push(root);
  return root;
}

async function _server(
  root: string,
  onStream: () => void
): Promise<StartedAgentServer> {
  const fingerprint = "7".repeat(64);
  return startAgentServer({
    artifactFingerprint: fingerprint,
    authenticator: createStaticBearerAuthenticator([
      {
        issuer: "test",
        principalId: "principal-one",
        principalType: "user",
        token: AUTH_TOKEN
      },
      {
        issuer: "test",
        principalId: "principal-two",
        principalType: "user",
        token: OTHER_AUTH_TOKEN
      }
    ]),
    hostname: "127.0.0.1",
    localDev: true,
    models: _models(onStream),
    port: 0,
    project: _project(fingerprint),
    repositoryRoot: root
  });
}

function _client(server: StartedAgentServer) {
  return createAgentServerClient({
    baseUrl: server.url,
    authorization: AUTH_TOKEN
  });
}

function _continuationToken(seed: number): string {
  return Buffer.from(new Uint8Array(32).fill(seed)).toString("base64url");
}

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
      stream: (_model: Model<Api>, context: Context) => {
        onStream();
        return _stream(context);
      },
      streamSimple: (_model: Model<Api>, context: Context) => {
        onStream();
        return _stream(context);
      }
    }
  }));
  return models;
}

function _stream(context: Context) {
  const hasToolResult = context.messages.at(-1)?.role === "toolResult";
  const message: AssistantMessage = hasToolResult
    ? _message([{ type: "text", text: "done" }], "stop")
    : _message([{
      type: "toolCall",
      id: `budget-${crypto.randomUUID()}`,
      name: "budgetTool",
      arguments: {}
    }], "toolUse");
  const stream = createAssistantMessageEventStream();
  queueMicrotask(() => {
    stream.push({ type: "start", partial: message });
    stream.push({ type: "done", reason: message.stopReason, message });
  });
  return stream;
}

function _message(
  content: AssistantMessage["content"],
  stopReason: AssistantMessage["stopReason"]
): AssistantMessage {
  return {
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
    stopReason,
    timestamp: Date.now()
  };
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
    definition: {
      model: { provider: "fake", id: "fake-model" },
      limits: {
        maxInputTokensPerSession: 1,
        maxOutputTokensPerSession: 1
      }
    },
    instructions: "Answer briefly.",
    tools: [{
      name: "budgetTool",
      label: "Budget tool",
      description: "Complete the crossing tool batch.",
      parameters: { type: "object", properties: {} },
      async execute() {
        return {
          content: [{ type: "text" as const, text: "complete" }],
          details: { completed: true }
        };
      }
    }],
    connections: [],
    resources: { skills: [] },
    diagnostics: [],
    fingerprint
  };
}
