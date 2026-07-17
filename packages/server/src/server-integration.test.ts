import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type Api,
  type AssistantMessage,
  type Context,
  createAssistantMessageEventStream,
  createModels,
  createProvider,
  type Model,
  type Models
} from "@earendil-works/pi-ai";
import {
  AgentServerClientError,
  type AgentServerStreamEvent,
  createAgentServerClient
} from "@llm-space/runtime/client";
import { defineDynamic, defineInstructions } from "@llm-space/runtime/instructions";
import { getActiveAgentSessionContext } from "@llm-space/runtime/server";
import { defineState } from "@llm-space/runtime/state";
import { afterEach, describe, expect, test } from "bun:test";
import { Type } from "typebox";

import type { CompiledAgentProjectSnapshot } from "@llm-space/runtime/node";

import {
  createStaticBearerAuthenticator,
  startAgentServer,
  type StartedAgentServer
} from "./index";

const servers: StartedAgentServer[] = [];
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(async server => server.stop()));
  await Promise.all(roots.splice(0).map(async root => rm(root, { force: true, recursive: true })));
});

describe("Agent Server HTTP protocol", () => {
  test("exposes liveness and creates an authenticated empty Session", async () => {
    const root = await mkdtemp(join(tmpdir(), "llm-space-server-"));
    roots.push(root);
    const server = await startAgentServer({
      artifactFingerprint: "a".repeat(64),
      authenticator: createStaticBearerAuthenticator([
        {
          issuer: "test",
          principalId: "principal-one",
          principalType: "user",
          token: "auth-token-with-at-least-thirty-two-bytes"
        }
      ]),
      hostname: "127.0.0.1",
      localDev: true,
      models: _models(),
      port: 0,
      project: _project("a".repeat(64)),
      repositoryRoot: root
    });
    servers.push(server);

    const health = await fetch(`${server.url}/v1/health`);
    expect(health.status).toBe(200);
    expect(health.headers.get("vary")).toBe("Origin");
    expect(await health.json()).toEqual({ status: "ok" });

    const unauthorized = await fetch(`${server.url}/v1/sessions`, {
      method: "POST"
    });
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get("www-authenticate")).toBe("Bearer");
    expect(unauthorized.headers.get("cache-control")).toBe("no-store");

    const invalidContinuation = await fetch(`${server.url}/v1/sessions`, {
      method: "POST",
      headers: {
        authorization: "Bearer auth-token-with-at-least-thirty-two-bytes",
        "idempotency-key": "invalid-continuation",
        "llm-space-next-continuation": "*".repeat(64)
      }
    });
    expect(invalidContinuation.status).toBe(400);

    const created = await fetch(`${server.url}/v1/sessions`, {
      method: "POST",
      headers: {
        authorization: "Bearer auth-token-with-at-least-thirty-two-bytes",
        "idempotency-key": "create-session-one",
        "llm-space-next-continuation": _continuationToken(1)
      }
    });
    expect(created.status).toBe(201);
    expect(created.headers.get("cache-control")).toBe("no-store");
    expect(await created.json()).toEqual({
      schemaVersion: 1,
      sessionId: expect.stringMatching(/^session-[0-9a-f-]+$/),
      continuation: {
        generation: 1,
        expiresAt: expect.any(String)
      }
    });
  });

  test("sanitizes unexpected request-handler failures", async () => {
    const root = await mkdtemp(join(tmpdir(), "llm-space-server-"));
    roots.push(root);
    const fingerprint = "9".repeat(64);
    const principal = {
      issuer: "test",
      principalId: "principal-one",
      principalType: "user" as const
    };
    const server = await startAgentServer({
      artifactFingerprint: fingerprint,
      authenticator: {
        async authenticate() {
          return new Proxy(principal, {
            get(target, property, receiver) {
              if (property === "issuer") {
                throw new Error("private internal failure");
              }
              return Reflect.get(target, property, receiver) as unknown;
            }
          });
        }
      },
      hostname: "127.0.0.1",
      localDev: true,
      models: _models(),
      port: 0,
      project: _project(fingerprint),
      repositoryRoot: root
    });
    servers.push(server);
    const response = await fetch(`${server.url}/v1/sessions`, {
      method: "POST",
      headers: _headers(_continuationToken(16), "internal-error")
    });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      schemaVersion: 1,
      error: { code: "internal_error" }
    });
  });

  test("fails startup when the artifact-selected model has no Host auth", async () => {
    const root = await mkdtemp(join(tmpdir(), "llm-space-server-"));
    roots.push(root);
    const fingerprint = "8".repeat(64);
    try {
      await startAgentServer({
        artifactFingerprint: fingerprint,
        authenticator: createStaticBearerAuthenticator([
          {
            issuer: "test",
            principalId: "principal-one",
            principalType: "user",
            token: "auth-token-with-at-least-thirty-two-bytes"
          }
        ]),
        hostname: "127.0.0.1",
        localDev: true,
        models: _models(false),
        port: 0,
        project: _project(fingerprint),
        repositoryRoot: root
      });
      throw new Error("Expected missing model auth to fail startup");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain("not configured");
    }
  });

  test("replays Session creation idempotently across restart", async () => {
    const root = await mkdtemp(join(tmpdir(), "llm-space-server-"));
    roots.push(root);
    const options = {
      artifactFingerprint: "b".repeat(64),
      authenticator: createStaticBearerAuthenticator([
        {
          issuer: "test",
          principalId: "principal-one",
          principalType: "user" as const,
          token: "auth-token-with-at-least-thirty-two-bytes"
        }
      ]),
      hostname: "127.0.0.1",
      localDev: true,
      models: _models(),
      port: 0,
      project: _project("b".repeat(64)),
      repositoryRoot: root
    };
    const headers = {
      authorization: "Bearer auth-token-with-at-least-thirty-two-bytes",
      "idempotency-key": "stable-create",
      "llm-space-next-continuation": _continuationToken(2)
    };
    const firstServer = await startAgentServer(options);
    const first = await fetch(`${firstServer.url}/v1/sessions`, {
      method: "POST",
      headers
    });
    const firstBody = await first.json();
    await firstServer.stop();

    const restarted = await startAgentServer(options);
    servers.push(restarted);
    const replay = await fetch(`${restarted.url}/v1/sessions`, {
      method: "POST",
      headers
    });
    expect(replay.status).toBe(201);
    expect(await replay.json()).toEqual(firstBody);

    const conflict = await fetch(`${restarted.url}/v1/sessions`, {
      method: "POST",
      headers: {
        ...headers,
        "llm-space-next-continuation": _continuationToken(3)
      }
    });
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({
      schemaVersion: 1,
      error: { code: "idempotency_conflict" }
    });
  });

  test("fails closed when another Server owns the repository root", async () => {
    const root = await mkdtemp(join(tmpdir(), "llm-space-server-"));
    roots.push(root);
    const fingerprint = "0".repeat(64);
    const options = {
      artifactFingerprint: fingerprint,
      authenticator: createStaticBearerAuthenticator([
        {
          issuer: "test",
          principalId: "principal-one",
          principalType: "user" as const,
          token: "auth-token-with-at-least-thirty-two-bytes"
        }
      ]),
      hostname: "127.0.0.1",
      localDev: true,
      models: _models(),
      port: 0,
      project: _project(fingerprint),
      repositoryRoot: root
    };
    const attempts = await Promise.allSettled([
      startAgentServer(options),
      startAgentServer(options)
    ]);
    const started = attempts.filter(
      (result): result is PromiseFulfilledResult<StartedAgentServer> =>
        result.status === "fulfilled"
    );
    const rejected = attempts.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected"
    );
    expect(started).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const server = started[0]!.value;
    servers.push(server);
    expect(rejected[0]!.reason).toBeInstanceOf(Error);
    expect((rejected[0]!.reason as Error).message)
      .toContain("already owned by another process");
  });

  test("runs the frozen Agent and streams Pi events plus one durable terminal", async () => {
    const root = await mkdtemp(join(tmpdir(), "llm-space-server-"));
    roots.push(root);
    const server = await startAgentServer({
      artifactFingerprint: "c".repeat(64),
      authenticator: createStaticBearerAuthenticator([
        {
          issuer: "test",
          principalId: "principal-one",
          principalType: "user",
          token: "auth-token-with-at-least-thirty-two-bytes"
        },
        {
          issuer: "test",
          principalId: "principal-two",
          principalType: "user",
          token: "second-auth-token-with-at-least-thirty-two"
        }
      ]),
      hostname: "127.0.0.1",
      localDev: true,
      models: _models(),
      port: 0,
      project: _project("c".repeat(64)),
      repositoryRoot: root
    });
    servers.push(server);
    const continuation = _continuationToken(4);
    const sessionResponse = await fetch(`${server.url}/v1/sessions`, {
      method: "POST",
      headers: _headers(continuation, "session-for-run")
    });
    const session = await sessionResponse.json() as { sessionId: string; };

    const created = await fetch(
      `${server.url}/v1/sessions/${session.sessionId}/runs`,
      {
        method: "POST",
        headers: {
          ..._headers(continuation, "run-one"),
          "content-type": "application/json",
          "llm-space-continuation": continuation
        },
        body: JSON.stringify({ input: { type: "text", text: "hello" } })
      }
    );
    expect(created.status).toBe(202);
    const run = await created.json() as { runId: string; };
    expect(run.runId).toMatch(/^run-[0-9a-f-]+$/);

    const events = await fetch(
      `${server.url}/v1/sessions/${session.sessionId}/runs/${run.runId}/events`,
      {
        headers: {
          authorization: "Bearer auth-token-with-at-least-thirty-two-bytes",
          "llm-space-continuation": continuation
        }
      }
    );
    expect(events.status).toBe(200);
    expect(events.headers.get("content-type")).toContain("text/event-stream");
    const stream = await events.text();
    expect(stream).toContain("event: pi");
    expect(stream).toContain('"type":"message_update"');
    expect(stream).toContain('"type":"text_delta"');
    expect(stream).toContain("event: control");
    expect(stream).toContain(
      '"type":"runTerminal","outcome":"completed"'
    );
    expect(stream.match(/^id: /gm)?.length).toBeGreaterThan(2);
    const ids = [...stream.matchAll(/^id: (\d+)$/gm)].map(match =>
      Number(match[1]));
    const cursor = ids[1];
    if (!cursor) {
      throw new Error("Expected at least two persisted event ids");
    }
    const replay = await fetch(
      `${server.url}/v1/sessions/${session.sessionId}/runs/${run.runId}/events`,
      {
        headers: {
          ..._observationHeaders(continuation),
          "last-event-id": String(cursor)
        }
      }
    );
    const replayText = await replay.text();
    const replayIds = [...replayText.matchAll(/^id: (\d+)$/gm)].map(match =>
      Number(match[1]));
    expect(replayIds).toEqual(ids.filter(id => id > cursor));
    expect((await fetch(
      `${server.url}/v1/sessions/${session.sessionId}/runs/${run.runId}/events`,
      {
        headers: {
          ..._observationHeaders(continuation),
          "last-event-id": "999999"
        }
      }
    )).status).toBe(400);
    expect((await fetch(
      `${server.url}/v1/sessions/${session.sessionId}/runs/${run.runId}/events`,
      {
        headers: {
          authorization: "Bearer second-auth-token-with-at-least-thirty-two",
          "llm-space-continuation": continuation,
          "last-event-id": "not-a-cursor"
        }
      }
    )).status).toBe(404);
    expect((await fetch(
      `${server.url}/v1/sessions/${session.sessionId}/runs/${run.runId}/events`,
      {
        headers: {
          ..._observationHeaders(_continuationToken(99)),
          "last-event-id": "not-a-cursor"
        }
      }
    )).status).toBe(404);
    expect((await fetch(
      `${server.url}/v1/sessions/${session.sessionId}/runs`,
      {
        method: "POST",
        headers: {
          authorization: "Bearer second-auth-token-with-at-least-thirty-two",
          "content-type": "application/json",
          "idempotency-key": "hidden-invalid-body",
          "llm-space-continuation": continuation
        },
        body: "not-json"
      }
    )).status).toBe(404);
  });

  test("supports the browser-safe client over Pi event types", async () => {
    const root = await mkdtemp(join(tmpdir(), "llm-space-server-"));
    roots.push(root);
    const fingerprint = "d".repeat(64);
    const server = await startAgentServer({
      artifactFingerprint: fingerprint,
      authenticator: createStaticBearerAuthenticator([
        {
          issuer: "test",
          principalId: "principal-one",
          principalType: "user",
          token: "auth-token-with-at-least-thirty-two-bytes"
        }
      ]),
      hostname: "127.0.0.1",
      localDev: true,
      models: _models(),
      port: 0,
      project: _project(fingerprint),
      repositoryRoot: root
    });
    servers.push(server);
    const client = createAgentServerClient({
      baseUrl: server.url,
      authorization: "auth-token-with-at-least-thirty-two-bytes",
      fetch: _disconnectFirstEventOnce(),
      retryCapMs: 10
    });
    const session = await client.createSession({
      continuationToken: _continuationToken(5),
      idempotencyKey: "client-session"
    });
    const run = await client.createRun({
      sessionId: session.sessionId,
      continuationToken: session.continuationToken,
      idempotencyKey: "client-run",
      text: "hello"
    });
    const events: AgentServerStreamEvent[] = [];
    for await (const event of client.streamRun({
      sessionId: session.sessionId,
      runId: run.runId,
      continuationToken: session.continuationToken
    })) {
      events.push(event);
    }
    expect(events.some(event =>
      event.event === "pi" && event.data.type === "message_update")).toBe(true);
    expect(events.at(-1)).toMatchObject({
      event: "control",
      data: { type: "runTerminal", outcome: "completed" }
    });
    expect(events.map(event => event.sequence)).toEqual(
      events.map((_event, index) => index + 1)
    );
    expect(events.filter(event =>
      event.event === "control" && event.data.type === "runTerminal")).toHaveLength(1);
  });

  test("isolates verified principal state and recovers it after restart", async () => {
    const root = await mkdtemp(join(tmpdir(), "llm-space-server-state-"));
    roots.push(root);
    const fingerprint = "7".repeat(64);
    const authenticator = createStaticBearerAuthenticator([
      {
        issuer: "test",
        principalId: "principal-one",
        principalType: "user",
        tenant: { issuer: "test", tenantId: "tenant-one" },
        token: "principal-one-token-with-thirty-two-bytes"
      },
      {
        issuer: "test",
        principalId: "principal-two",
        principalType: "user",
        tenant: { issuer: "test", tenantId: "tenant-two" },
        token: "principal-two-token-with-thirty-two-bytes"
      }
    ]);
    const instructionResolutions: string[] = [];
    const options = {
      artifactFingerprint: fingerprint,
      authenticator,
      hostname: "127.0.0.1" as const,
      localDev: true,
      models: _models(),
      port: 0,
      project: _statefulProject(
        fingerprint,
        "server-state-v1",
        markdown => { instructionResolutions.push(markdown); }
      ),
      repositoryRoot: root
    };
    const first = await startAgentServer(options);
    const firstClient = createAgentServerClient({
      baseUrl: first.url,
      authorization: "principal-one-token-with-thirty-two-bytes"
    });
    const secondClient = createAgentServerClient({
      baseUrl: first.url,
      authorization: "principal-two-token-with-thirty-two-bytes"
    });
    const firstSession = await firstClient.createSession({
      continuationToken: _continuationToken(21),
      idempotencyKey: "principal-one-session"
    });
    const secondSession = await secondClient.createSession({
      continuationToken: _continuationToken(22),
      idempotencyKey: "principal-two-session"
    });
    await _completeClientRun(firstClient, firstSession, "first-run");
    await _completeClientRun(secondClient, secondSession, "second-run");

    expect(await _rejection(secondClient.createRun({
      sessionId: firstSession.sessionId,
      continuationToken: firstSession.continuationToken,
      idempotencyKey: "cross-principal-run",
      text: "increment"
    }))).toMatchObject({ status: 404 });
    expect(await _storedServerState(root, firstSession.sessionId)).toEqual({
      count: 1,
      initiatorId: "principal-one",
      principalId: "principal-one",
      tenantId: "tenant-one",
      channel: "http",
      turnSequence: 1
    });
    expect(await _storedServerState(root, secondSession.sessionId)).toEqual({
      count: 1,
      initiatorId: "principal-two",
      principalId: "principal-two",
      tenantId: "tenant-two",
      channel: "http",
      turnSequence: 1
    });
    const firstInstructionSnapshots = await _storedInstructionSnapshots(
      root,
      firstSession.sessionId
    );
    expect(firstInstructionSnapshots).toHaveLength(1);
    expect(firstInstructionSnapshots[0]).toMatchObject({
      markdown: expect.stringContaining(
        "principal-one:tenant-one:http:1:0:read-only"
      )
    });

    await first.stop();
    const restarted = await startAgentServer(options);
    expect(await _storedInstructionSnapshots(root, firstSession.sessionId))
      .toEqual(firstInstructionSnapshots);
    const recoveredClient = createAgentServerClient({
      baseUrl: restarted.url,
      authorization: "principal-one-token-with-thirty-two-bytes"
    });
    await _completeClientRun(recoveredClient, firstSession, "recovered-run");
    expect(await _storedServerState(root, firstSession.sessionId)).toEqual({
      count: 2,
      initiatorId: "principal-one",
      principalId: "principal-one",
      tenantId: "tenant-one",
      channel: "http",
      turnSequence: 2
    });
    const recoveredInstructionSnapshots = await _storedInstructionSnapshots(
      root,
      firstSession.sessionId
    );
    expect(recoveredInstructionSnapshots).toHaveLength(2);
    expect(recoveredInstructionSnapshots[0]).toEqual(
      firstInstructionSnapshots[0]
    );
    expect(recoveredInstructionSnapshots[1]).toMatchObject({
      markdown: expect.stringContaining(
        "principal-one:tenant-one:http:2:1:read-only"
      )
    });
    expect(instructionResolutions).toContain(
      "principal-one:tenant-one:http:1:0:read-only"
    );
    expect(instructionResolutions).toContain(
      "principal-one:tenant-one:http:2:1:read-only"
    );
    await restarted.stop();

    const drifted = await startAgentServer({
      ...options,
      project: _statefulProject(fingerprint, "server-state-v2")
    });
    servers.push(drifted);
    const driftedClient = createAgentServerClient({
      baseUrl: drifted.url,
      authorization: "principal-one-token-with-thirty-two-bytes"
    });
    const terminal = await _completeClientRun(
      driftedClient,
      firstSession,
      "schema-drift-run"
    );
    expect(terminal).toMatchObject({
      event: "control",
      data: { type: "runTerminal", outcome: "failed" }
    });
    expect((await _storedServerState(root, firstSession.sessionId)).count)
      .toBe(2);
  });

  test("terminalizes interrupted model work as outcomeUnknown on restart", async () => {
    const root = await mkdtemp(join(tmpdir(), "llm-space-server-"));
    roots.push(root);
    const fingerprint = "e".repeat(64);
    const options = {
      artifactFingerprint: fingerprint,
      authenticator: createStaticBearerAuthenticator([
        {
          issuer: "test",
          principalId: "principal-one",
          principalType: "user" as const,
          token: "auth-token-with-at-least-thirty-two-bytes"
        }
      ]),
      hostname: "127.0.0.1",
      localDev: true,
      models: _models(),
      port: 0,
      project: _project(fingerprint),
      repositoryRoot: root
    };
    const first = await startAgentServer(options);
    const continuation = _continuationToken(6);
    const sessionResponse = await fetch(`${first.url}/v1/sessions`, {
      method: "POST",
      headers: _headers(continuation, "unknown-session")
    });
    const session = await sessionResponse.json() as { sessionId: string; };
    const runResponse = await fetch(
      `${first.url}/v1/sessions/${session.sessionId}/runs`,
      {
        method: "POST",
        headers: {
          ..._headers(continuation, "unknown-run"),
          "content-type": "application/json",
          "llm-space-continuation": continuation
        },
        body: JSON.stringify({ input: { type: "text", text: "slow" } })
      }
    );
    const run = await runResponse.json() as { runId: string; };
    const sessionPath = join(root, `${session.sessionId}.json`);
    const persistedCrashState = await readFile(sessionPath, "utf8");
    const persisted = JSON.parse(persistedCrashState) as {
      transcript: Array<{ content: Array<{ text?: string; }>; role: string; }>;
    };
    expect(persisted.transcript.at(-1)).toMatchObject({
      role: "user",
      content: [{ type: "text", text: "slow" }]
    });
    const live = await fetch(
      `${first.url}/v1/sessions/${session.sessionId}/runs/${run.runId}/events`,
      { headers: _observationHeaders(continuation) }
    );
    if (!live.body) {
      throw new Error("Expected a live event body");
    }
    const reader = live.body.getReader();
    expect((await reader.read()).done).toBe(false);
    await reader.cancel("simulate process loss");
    await first.stop();
    await writeFile(sessionPath, persistedCrashState, "utf8");

    const restarted = await startAgentServer(options);
    servers.push(restarted);
    const recovered = await fetch(
      `${restarted.url}/v1/sessions/${session.sessionId}/runs/${run.runId}/events`,
      { headers: _observationHeaders(continuation) }
    );
    const stream = await recovered.text();
    expect(stream).toContain(
      '"type":"runTerminal","outcome":"outcomeUnknown","code":"process_interrupted"'
    );
    expect(stream.match(/"type":"runTerminal"/g)).toHaveLength(1);
  });

  test("rotates and revokes Channel-owned continuation credentials", async () => {
    const root = await mkdtemp(join(tmpdir(), "llm-space-server-"));
    roots.push(root);
    const fingerprint = "f".repeat(64);
    const server = await startAgentServer({
      artifactFingerprint: fingerprint,
      authenticator: createStaticBearerAuthenticator([
        {
          issuer: "test",
          principalId: "principal-one",
          principalType: "user",
          token: "auth-token-with-at-least-thirty-two-bytes"
        }
      ]),
      hostname: "127.0.0.1",
      localDev: true,
      models: _models(),
      port: 0,
      project: _project(fingerprint),
      repositoryRoot: root
    });
    servers.push(server);
    const client = createAgentServerClient({
      baseUrl: server.url,
      authorization: "auth-token-with-at-least-thirty-two-bytes"
    });
    const session = await client.createSession({
      continuationToken: _continuationToken(7),
      idempotencyKey: "rotate-session"
    });
    const nextToken = _continuationToken(8);
    const rotated = await client.rotateContinuation({
      sessionId: session.sessionId,
      continuationToken: session.continuationToken,
      nextContinuationToken: nextToken,
      idempotencyKey: "rotate-one"
    });
    const replayed = await client.rotateContinuation({
      sessionId: session.sessionId,
      continuationToken: session.continuationToken,
      nextContinuationToken: nextToken,
      idempotencyKey: "rotate-one"
    });
    expect(replayed).toEqual(rotated);
    expect(rotated.continuation.generation).toBe(2);
    try {
      await client.rotateContinuation({
        sessionId: session.sessionId,
        continuationToken: _continuationToken(98),
        nextContinuationToken: _continuationToken(97),
        idempotencyKey: "rotate-one"
      });
      throw new Error("Expected invalid rotation credential to stay hidden");
    } catch (error) {
      expect(error).toMatchObject({ status: 404, code: "not_found" });
    }
    expect(await client.createSession({
      continuationToken: session.continuationToken,
      idempotencyKey: "rotate-session"
    })).toEqual(session);

    try {
      await client.createRun({
        sessionId: session.sessionId,
        continuationToken: session.continuationToken,
        idempotencyKey: "old-token-run",
        text: "blocked"
      });
      throw new Error("Expected the rotated token to be hidden");
    } catch (error) {
      expect(error).toBeInstanceOf(AgentServerClientError);
      expect(error).toMatchObject({ status: 404, code: "not_found" });
    }

    const observedRun = await client.createRun({
      sessionId: session.sessionId,
      continuationToken: rotated.continuationToken,
      idempotencyKey: "revoked-observer-run",
      text: "slow"
    });
    const observer = client.streamRun({
      sessionId: session.sessionId,
      runId: observedRun.runId,
      continuationToken: rotated.continuationToken
    })[Symbol.asyncIterator]();
    expect((await observer.next()).done).toBe(false);
    await client.revokeContinuation({
      sessionId: session.sessionId,
      continuationToken: rotated.continuationToken
    });
    try {
      let next = await observer.next();
      while (!next.done) {
        next = await observer.next();
      }
      throw new Error("Expected revocation to disconnect the observer");
    } catch (error) {
      expect(error).toMatchObject({ status: 404, code: "not_found" });
    }
    try {
      await client.createRun({
        sessionId: session.sessionId,
        continuationToken: rotated.continuationToken,
        idempotencyKey: "revoked-token-run",
        text: "blocked"
      });
      throw new Error("Expected the revoked token to be hidden");
    } catch (error) {
      expect(error).toBeInstanceOf(AgentServerClientError);
      expect(error).toMatchObject({ status: 404, code: "not_found" });
    }
  });

  test("configures continuation TTL and hides expired credentials", async () => {
    const root = await mkdtemp(join(tmpdir(), "llm-space-server-"));
    roots.push(root);
    const fingerprint = "1".repeat(64);
    const options = {
      artifactFingerprint: fingerprint,
      authenticator: createStaticBearerAuthenticator([
        {
          issuer: "test",
          principalId: "principal-one",
          principalType: "user" as const,
          token: "auth-token-with-at-least-thirty-two-bytes"
        }
      ]),
      continuationTtlSeconds: 60,
      hostname: "127.0.0.1",
      localDev: true,
      models: _models(),
      port: 0,
      project: _project(fingerprint),
      repositoryRoot: root
    };
    try {
      await startAgentServer({ ...options, continuationTtlSeconds: 59 });
      throw new Error("Expected continuation TTL validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(TypeError);
    }
    const first = await startAgentServer(options);
    const client = createAgentServerClient({
      baseUrl: first.url,
      authorization: "auth-token-with-at-least-thirty-two-bytes"
    });
    const beforeCreate = Date.now();
    const session = await client.createSession({
      continuationToken: _continuationToken(15),
      idempotencyKey: "expiring-session"
    });
    expect(Date.parse(session.continuation.expiresAt) - beforeCreate)
      .toBeGreaterThanOrEqual(59_000);
    expect(Date.parse(session.continuation.expiresAt) - beforeCreate)
      .toBeLessThanOrEqual(61_000);
    await first.stop();

    const fileName = (await readdir(root)).find(name => name.endsWith(".json"));
    if (!fileName) {
      throw new Error("Expected a persisted Server Session");
    }
    const path = join(root, fileName);
    const envelope = JSON.parse(await readFile(path, "utf8")) as {
      continuation: { expiresAt: string; };
    };
    envelope.continuation.expiresAt = new Date(Date.now() - 1_000).toISOString();
    await writeFile(path, `${JSON.stringify(envelope)}\n`, "utf8");

    const restarted = await startAgentServer(options);
    servers.push(restarted);
    const revoke = await fetch(
      `${restarted.url}/v1/sessions/${session.sessionId}/continuation/revoke`,
      {
        method: "POST",
        headers: _observationHeaders(session.continuationToken)
      }
    );
    expect(revoke.status).toBe(404);
  });

  test("aborts explicitly while observation disconnect remains passive", async () => {
    const root = await mkdtemp(join(tmpdir(), "llm-space-server-"));
    roots.push(root);
    const fingerprint = "1".repeat(64);
    const server = await startAgentServer({
      artifactFingerprint: fingerprint,
      authenticator: createStaticBearerAuthenticator([
        {
          issuer: "test",
          principalId: "principal-one",
          principalType: "user",
          token: "auth-token-with-at-least-thirty-two-bytes"
        }
      ]),
      hostname: "127.0.0.1",
      localDev: true,
      models: _models(),
      port: 0,
      project: _project(fingerprint),
      repositoryRoot: root
    });
    servers.push(server);
    const client = createAgentServerClient({
      baseUrl: server.url,
      authorization: "auth-token-with-at-least-thirty-two-bytes"
    });
    const session = await client.createSession({
      continuationToken: _continuationToken(9),
      idempotencyKey: "abort-session"
    });
    const run = await client.createRun({
      sessionId: session.sessionId,
      continuationToken: session.continuationToken,
      idempotencyKey: "abort-run",
      text: "hang"
    });
    const events = [];
    let abortStatus: "aborting" | "terminal" | undefined;
    for await (const event of client.streamRun({
      sessionId: session.sessionId,
      runId: run.runId,
      continuationToken: session.continuationToken
    })) {
      events.push(event);
      if (!abortStatus && event.event === "pi") {
        ({ status: abortStatus } = await client.abortRun({
          sessionId: session.sessionId,
          runId: run.runId,
          continuationToken: session.continuationToken
        }));
      }
    }
    expect(abortStatus).toBe("aborting");
    expect(events.at(-1)).toMatchObject({
      event: "control",
      data: { type: "runTerminal", outcome: "cancelled" }
    });
    expect(await client.abortRun({
      sessionId: session.sessionId,
      runId: run.runId,
      continuationToken: session.continuationToken
    })).toEqual({ status: "terminal", outcome: "cancelled" });
  });

  test("enforces explicit CORS and rejects new Runs before capacity mutation", async () => {
    const root = await mkdtemp(join(tmpdir(), "llm-space-server-"));
    roots.push(root);
    const fingerprint = "2".repeat(64);
    const server = await startAgentServer({
      artifactFingerprint: fingerprint,
      allowedOrigins: ["http://localhost:3000"],
      authenticator: createStaticBearerAuthenticator([
        {
          issuer: "test",
          principalId: "principal-one",
          principalType: "user",
          token: "auth-token-with-at-least-thirty-two-bytes"
        }
      ]),
      hostname: "127.0.0.1",
      localDev: true,
      maxActiveRuns: 1,
      models: _models(),
      port: 0,
      project: _project(fingerprint),
      repositoryRoot: root
    });
    servers.push(server);
    const preflight = await fetch(`${server.url}/v1/sessions`, {
      method: "OPTIONS",
      headers: {
        origin: "http://localhost:3000",
        "access-control-request-method": "POST",
        "access-control-request-headers": "authorization, idempotency-key"
      }
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin"))
      .toBe("http://localhost:3000");
    expect(preflight.headers.get("access-control-allow-credentials")).toBeNull();
    expect(preflight.headers.get("vary")).toContain("Origin");
    expect((await fetch(`${server.url}/v1/health`)).headers.get("vary"))
      .toContain("Origin");
    expect((await fetch(`${server.url}/not-a-protocol-route`, {
      method: "OPTIONS",
      headers: {
        origin: "http://localhost:3000",
        "access-control-request-method": "POST"
      }
    })).status).toBe(403);
    expect((await fetch(`${server.url}/v1/health`, {
      headers: { origin: "https://attacker.invalid" }
    })).status).toBe(403);

    const client = createAgentServerClient({
      baseUrl: server.url,
      authorization: "auth-token-with-at-least-thirty-two-bytes"
    });
    const firstSession = await client.createSession({
      continuationToken: _continuationToken(10),
      idempotencyKey: "capacity-session-one"
    });
    const secondSession = await client.createSession({
      continuationToken: _continuationToken(11),
      idempotencyKey: "capacity-session-two"
    });
    const firstRun = await client.createRun({
      sessionId: firstSession.sessionId,
      continuationToken: firstSession.continuationToken,
      idempotencyKey: "capacity-run-one",
      text: "slow"
    });
    try {
      await client.createRun({
        sessionId: secondSession.sessionId,
        continuationToken: secondSession.continuationToken,
        idempotencyKey: "capacity-run-two",
        text: "hello"
      });
      throw new Error("Expected Run capacity to reject before creation");
    } catch (error) {
      expect(error).toMatchObject({
        status: 429,
        code: "capacity_exhausted"
      });
    }
    expect(await client.createRun({
      sessionId: firstSession.sessionId,
      continuationToken: firstSession.continuationToken,
      idempotencyKey: "capacity-run-one",
      text: "slow"
    })).toEqual(firstRun);
    const settledEvents = [];
    for await (const event of client.streamRun({
      sessionId: firstSession.sessionId,
      runId: firstRun.runId,
      continuationToken: firstSession.continuationToken
    })) {
      settledEvents.push(event);
    }
    expect(settledEvents.at(-1)).toMatchObject({
      data: { type: "runTerminal", outcome: "completed" }
    });
    const secondRun = await client.createRun({
      sessionId: secondSession.sessionId,
      continuationToken: secondSession.continuationToken,
      idempotencyKey: "capacity-run-two",
      text: "hello"
    });
    expect(secondRun.runId).toMatch(/^run-/);
  });

  test("fails non-loopback plaintext closed and validates a trusted terminator", async () => {
    const root = await mkdtemp(join(tmpdir(), "llm-space-server-"));
    roots.push(root);
    const fingerprint = "3".repeat(64);
    const base = {
      artifactFingerprint: fingerprint,
      authenticator: createStaticBearerAuthenticator([
        {
          issuer: "test",
          principalId: "principal-one",
          principalType: "user" as const,
          token: "auth-token-with-at-least-thirty-two-bytes"
        }
      ]),
      hostname: "0.0.0.0",
      models: _models(),
      port: 0,
      project: _project(fingerprint),
      repositoryRoot: root
    };
    try {
      await startAgentServer(base);
      throw new Error("Expected non-loopback plaintext startup to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain(
        "Bun TLS, or a trusted TLS terminator"
      );
    }
    try {
      await startAgentServer({ ...base, localDev: true });
      throw new Error("Expected non-loopback local-dev startup to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain("must bind to a loopback");
    }
    try {
      await startAgentServer({
        ...base,
        trustedProxyCidrs: ["127.0.0.1/32"]
      });
      throw new Error("Expected terminator mode without public Host to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain("allowed public Host");
    }
    try {
      await startAgentServer({
        ...base,
        allowedHosts: ["127.0.0.1"],
        trustedProxyCidrs: ["127.0.0.1/32"]
      });
      throw new Error("Expected loopback terminator Host to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain("allowed public Host");
    }
    try {
      await startAgentServer({
        ...base,
        allowedHosts: ["agent.example"],
        trustedProxyCidrs: ["not-an-ip"]
      });
      throw new Error("Expected invalid trusted proxy configuration to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(TypeError);
    }
    try {
      await startAgentServer({
        ...base,
        hostname: "127.0.0.1",
        localDev: true,
        allowedOrigins: ["http://remote.example"]
      });
      throw new Error("Expected remote HTTP CORS origin to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(TypeError);
      expect((error as Error).message).toContain("loopback HTTP origins");
    }

    const server = await startAgentServer({
      ...base,
      allowedHosts: ["agent.example"],
      trustedProxyCidrs: ["127.0.0.1/32"]
    });
    servers.push(server);
    const url = server.url.replace("0.0.0.0", "127.0.0.1");
    expect(await _directHttpStatus(`${url}/v1/health`, {
      host: "127.0.0.1"
    })).toBe(200);
    expect(await _directHttpStatus(`${url}/v1/ready`, {
      host: "127.0.0.1"
    })).toBe(200);
    expect(await _directHttpStatus(`${url}/v1/sessions`, {
      host: "127.0.0.1"
    }, "POST")).toBe(400);
    expect(await _directHttpStatus(`${url}/v1/health`, {
      host: "agent.example"
    })).toBe(400);
    expect(await _directHttpStatus(`${url}/v1/health`, {
      host: "agent.example",
      "x-forwarded-proto": "https,http"
    })).toBe(400);
    expect(await _directHttpStatus(`${url}/v1/health`, {
      host: "agent.example",
      forwarded: "for=127.0.0.1;proto=https;proto=http"
    })).toBe(400);
    expect(await _directHttpStatus(`${url}/v1/health`, {
      host: "127.0.0.1",
      "x-forwarded-proto": "https"
    })).toBe(200);
    const proxied = await _directHttpStatus(`${url}/v1/health`, {
      host: "agent.example",
      "x-forwarded-proto": "https"
    });
    expect(proxied).toBe(200);
  });

  test("rejects oversized input before mutation and fails unsafe Pi events honestly", async () => {
    const root = await mkdtemp(join(tmpdir(), "llm-space-server-"));
    roots.push(root);
    const fingerprint = "4".repeat(64);
    const server = await startAgentServer({
      artifactFingerprint: fingerprint,
      authenticator: createStaticBearerAuthenticator([
        {
          issuer: "test",
          principalId: "principal-one",
          principalType: "user",
          token: "auth-token-with-at-least-thirty-two-bytes"
        }
      ]),
      hostname: "127.0.0.1",
      localDev: true,
      models: _models(),
      port: 0,
      project: _project(fingerprint),
      repositoryRoot: root
    });
    servers.push(server);
    const continuation = _continuationToken(12);
    const created = await fetch(`${server.url}/v1/sessions`, {
      method: "POST",
      headers: _headers(continuation, "limit-session")
    });
    const session = await created.json() as { sessionId: string; };
    const oversizedInput = await fetch(
      `${server.url}/v1/sessions/${session.sessionId}/runs`,
      {
        method: "POST",
        headers: {
          ..._headers(continuation, "oversized-input"),
          "content-type": "application/json",
          "llm-space-continuation": continuation
        },
        body: JSON.stringify({
          input: { type: "text", text: "x".repeat((32 * 1024) + 1) }
        })
      }
    );
    expect(oversizedInput.status).toBe(413);
    const oversizedHeader = await fetch(`${server.url}/v1/sessions`, {
      method: "POST",
      headers: {
        ..._headers("x".repeat(1_025), "oversized-header")
      }
    });
    expect(oversizedHeader.status).toBe(413);
    const oversizedBodyHeaders = _headers(
      _continuationToken(14),
      "oversized-session-body"
    );
    const oversizedBody = await fetch(`${server.url}/v1/sessions`, {
      method: "POST",
      headers: oversizedBodyHeaders,
      body: "x".repeat((64 * 1024) + 1)
    });
    expect(oversizedBody.status).toBe(413);
    expect((await fetch(`${server.url}/v1/sessions`, {
      method: "POST",
      headers: oversizedBodyHeaders
    })).status).toBe(201);

    const client = createAgentServerClient({
      baseUrl: server.url,
      authorization: "auth-token-with-at-least-thirty-two-bytes"
    });
    for (const [text, code] of [
      ["large-event", "event_too_large"],
      ["invalid-json", "event_not_serializable"]
    ] as const) {
      const run = await client.createRun({
        sessionId: session.sessionId,
        continuationToken: continuation,
        idempotencyKey: `unsafe-${text}`,
        text
      });
      const events = [];
      for await (const event of client.streamRun({
        sessionId: session.sessionId,
        runId: run.runId,
        continuationToken: continuation
      })) {
        events.push(event);
      }
      expect(events.at(-1)).toMatchObject({
        data: { type: "runTerminal", outcome: "failed", code }
      });
    }
  });

  test("notifies observers and settles active Runs during graceful shutdown", async () => {
    const root = await mkdtemp(join(tmpdir(), "llm-space-server-"));
    roots.push(root);
    const fingerprint = "5".repeat(64);
    const server = await startAgentServer({
      artifactFingerprint: fingerprint,
      authenticator: createStaticBearerAuthenticator([
        {
          issuer: "test",
          principalId: "principal-one",
          principalType: "user",
          token: "auth-token-with-at-least-thirty-two-bytes"
        }
      ]),
      hostname: "127.0.0.1",
      localDev: true,
      models: _models(),
      port: 0,
      project: _project(fingerprint),
      repositoryRoot: root,
      shutdownTimeoutSeconds: 1
    });
    const client = createAgentServerClient({
      baseUrl: server.url,
      authorization: "auth-token-with-at-least-thirty-two-bytes"
    });
    const session = await client.createSession({
      continuationToken: _continuationToken(13),
      idempotencyKey: "shutdown-session"
    });
    const run = await client.createRun({
      sessionId: session.sessionId,
      continuationToken: session.continuationToken,
      idempotencyKey: "shutdown-run",
      text: "hang"
    });
    const iterator = client.streamRun({
      sessionId: session.sessionId,
      runId: run.runId,
      continuationToken: session.continuationToken
    })[Symbol.asyncIterator]();
    const events = [];
    while (true) {
      const next = await iterator.next();
      expect(next.done).toBe(false);
      const value = next.value as AgentServerStreamEvent | undefined;
      if (!value) {
        continue;
      }
      events.push(value);
      if (
        value.event === "pi"
        && value.data.type === "message_start"
        && value.data.message.role === "assistant"
      ) {
        break;
      }
    }
    const stopping = server.stop();
    while (true) {
      const next = await iterator.next();
      if (next.done) {
        break;
      }
      events.push(next.value);
    }
    await stopping;
    expect(events).toContainEqual({
      sequence: null,
      event: "control",
      data: { type: "serverShutdown", retryAfterSeconds: 1 }
    });
    expect(events.at(-1)).toMatchObject({
      data: { type: "runTerminal", outcome: "cancelled" }
    });
  });

  test("releases repository ownership after a timed-out shutdown", async () => {
    const root = await mkdtemp(join(tmpdir(), "llm-space-server-"));
    roots.push(root);
    const fingerprint = "6".repeat(64);
    const options = {
      artifactFingerprint: fingerprint,
      authenticator: createStaticBearerAuthenticator([{
        issuer: "test",
        principalId: "principal-one",
        principalType: "user" as const,
        token: "auth-token-with-at-least-thirty-two-bytes"
      }]),
      hostname: "127.0.0.1",
      localDev: true,
      models: _models(),
      port: 0,
      project: _project(fingerprint),
      repositoryRoot: root,
      shutdownTimeoutSeconds: 1
    };
    const server = await startAgentServer(options);
    const client = createAgentServerClient({
      baseUrl: server.url,
      authorization: "auth-token-with-at-least-thirty-two-bytes"
    });
    const session = await client.createSession({
      continuationToken: _continuationToken(17),
      idempotencyKey: "timed-out-shutdown-session"
    });
    const run = await client.createRun({
      sessionId: session.sessionId,
      continuationToken: session.continuationToken,
      idempotencyKey: "timed-out-shutdown-run",
      text: "stuck"
    });
    const observer = client.streamRun({
      sessionId: session.sessionId,
      runId: run.runId,
      continuationToken: session.continuationToken
    })[Symbol.asyncIterator]();
    while (true) {
      const next = await observer.next();
      if (
        next.done
        || (next.value.event === "pi"
          && next.value.data.type === "message_start")
      ) {
        break;
      }
    }
    await observer.return?.();

    await server.stop();
    const restarted = await startAgentServer(options);
    servers.push(restarted);
    const recoveredClient = createAgentServerClient({
      baseUrl: restarted.url,
      authorization: "auth-token-with-at-least-thirty-two-bytes"
    });
    const recovered = [];
    for await (const event of recoveredClient.streamRun({
      sessionId: session.sessionId,
      runId: run.runId,
      continuationToken: session.continuationToken
    })) {
      recovered.push(event);
    }
    expect(recovered.at(-1)).toMatchObject({
      data: { type: "runTerminal", outcome: "outcomeUnknown" }
    });
  });
});

function _continuationToken(seed: number): string {
  const bytes = new Uint8Array(32).fill(seed);
  return Buffer.from(bytes).toString("base64url");
}

async function _rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("Expected operation to reject");
}

function _headers(continuation: string, idempotencyKey: string) {
  return {
    authorization: "Bearer auth-token-with-at-least-thirty-two-bytes",
    "idempotency-key": idempotencyKey,
    "llm-space-next-continuation": continuation
  };
}

function _observationHeaders(continuation: string) {
  return {
    authorization: "Bearer auth-token-with-at-least-thirty-two-bytes",
    "llm-space-continuation": continuation
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
    definition: { model: { provider: "fake", id: "fake-model" } },
    instructions: "Answer briefly.",
    tools: [{
      name: "unsafe",
      label: "Unsafe",
      description: "Return an intentionally unsafe test result.",
      parameters: { type: "object", properties: {} },
      async execute() {
        return Promise.resolve({
          content: [{ type: "text" as const, text: "unsafe" }],
          details: { value: 1n }
        });
      }
    }],
    connections: [],
    resources: { skills: [] },
    diagnostics: [],
    fingerprint
  };
}

const SERVER_STATE = defineState({
  name: "server.session",
  version: 1,
  schema: Type.Object({
    count: Type.Number(),
    initiatorId: Type.String(),
    principalId: Type.String(),
    tenantId: Type.String(),
    channel: Type.String(),
    turnSequence: Type.Number()
  }),
  initial: {
    count: 0,
    initiatorId: "",
    principalId: "",
    tenantId: "",
    channel: "",
    turnSequence: 0
  }
});

function _statefulProject(
  fingerprint: string,
  schemaFingerprint: string,
  onInstructions?: (markdown: string) => void
): CompiledAgentProjectSnapshot {
  const project = _project(fingerprint);
  const dynamicInstructions = defineDynamic({
    events: {
      "turn.started": (_event, { session }) => {
        const state = SERVER_STATE.get();
        let readOnly = "mutable";
        try {
          SERVER_STATE.update(current => current);
        } catch {
          readOnly = "read-only";
        }
        const markdown = [
          session.auth.current.principalId,
          session.tenant?.tenantId ?? "",
          session.channel.kind,
          session.turn.sequence,
          state.count,
          readOnly
        ].join(":");
        onInstructions?.(markdown);
        return defineInstructions({ markdown });
      }
    }
  });
  return {
    ...project,
    instructionEntries: [
      {
        kind: "static",
        markdown: project.instructions,
        sourcePath: "instructions.md"
      },
      {
        kind: "dynamic",
        definition: dynamicInstructions,
        sourcePath: "instructions/session.ts"
      }
    ],
    stateDefinitions: [{
      name: SERVER_STATE.name,
      version: SERVER_STATE.version,
      schema: SERVER_STATE.schema,
      schemaFingerprint,
      initial: SERVER_STATE.initial,
      sourcePath: "state/session.ts"
    }],
    tools: [{
      name: "increment",
      label: "Increment",
      description: "Increment durable Session state.",
      parameters: { type: "object", properties: {} },
      async execute() {
        const context = getActiveAgentSessionContext();
        SERVER_STATE.update(current => ({
          count: current.count + 1,
          initiatorId: context.auth.initiator.principalId,
          principalId: context.auth.current.principalId,
          tenantId: context.tenant?.tenantId ?? "",
          channel: context.channel.kind,
          turnSequence: context.turn.sequence
        }));
        const value = SERVER_STATE.get();
        return {
          content: [{ type: "text" as const, text: JSON.stringify(value) }],
          details: value
        };
      }
    }]
  };
}

async function _completeClientRun(
  client: ReturnType<typeof createAgentServerClient>,
  session: { continuationToken: string; sessionId: string; },
  idempotencyKey: string
): Promise<AgentServerStreamEvent | undefined> {
  const run = await client.createRun({
    sessionId: session.sessionId,
    continuationToken: session.continuationToken,
    idempotencyKey,
    text: "increment"
  });
  const events: AgentServerStreamEvent[] = [];
  for await (const event of client.streamRun({
    sessionId: session.sessionId,
    runId: run.runId,
    continuationToken: session.continuationToken
  })) {
    events.push(event);
  }
  return events.at(-1);
}

async function _storedServerState(
  root: string,
  sessionId: string
): Promise<{
  channel: string;
  count: number;
  initiatorId: string;
  principalId: string;
  tenantId: string;
  turnSequence: number;
}> {
  const envelope = JSON.parse(
    await readFile(join(root, `${sessionId}.json`), "utf8")
  ) as {
    runtime: {
      snapshot: {
        state: {
          values: Record<string, { value: unknown; }>;
        };
      };
    };
  };
  return envelope.runtime.snapshot.state.values[SERVER_STATE.name]!.value as
    Awaited<ReturnType<typeof _storedServerState>>;
}

async function _storedInstructionSnapshots(
  root: string,
  sessionId: string
): Promise<unknown[]> {
  const envelope = JSON.parse(
    await readFile(join(root, `${sessionId}.json`), "utf8")
  ) as {
    runtime: {
      snapshot: {
        instructionSnapshots?: Record<string, unknown>;
      };
    };
  };
  return Object.values(envelope.runtime.snapshot.instructionSnapshots ?? {});
}

function _models(configured = true): Models {
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
  const provider = createProvider({
    id: "fake",
    auth: {
      apiKey: {
        name: "Fake",
        resolve: async () => Promise.resolve(configured ? { auth: {} } : undefined)
      }
    },
    models: [model],
    api: {
      stream: (_model: Model<Api>, context: Context, options) =>
        _stream(context, options?.signal),
      streamSimple: (_model: Model<Api>, context: Context, options) =>
        _stream(context, options?.signal)
    }
  });
  const models = createModels();
  models.setProvider(provider);
  return models;
}

function _stream(context: Context, signal?: AbortSignal) {
  const stream = createAssistantMessageEventStream();
  const last = context.messages.at(-1);
  const prompt = _userText(last);
  if (prompt === "stuck") {
    queueMicrotask(() => {
      stream.push({ type: "start", partial: _partial("") });
    });
    return stream;
  }
  if (prompt === "hang") {
    queueMicrotask(() => {
      stream.push({ type: "start", partial: _partial("") });
    });
    signal?.addEventListener("abort", () => {
      const error = {
        ..._partial(""),
        stopReason: "aborted" as const,
        errorMessage: "aborted"
      };
      stream.push({ type: "error", reason: "aborted", error });
    }, { once: true });
    return stream;
  }
  if (prompt === "invalid-json") {
    const partial: AssistantMessage = {
      ..._partial(""),
      content: [{
        type: "toolCall",
        id: "unsafe-call",
        name: "unsafe",
        arguments: {}
      }],
      stopReason: "toolUse"
    };
    queueMicrotask(() => {
      stream.push({ type: "start", partial });
      stream.push({ type: "toolcall_start", contentIndex: 0, partial });
      stream.push({
        type: "toolcall_end",
        contentIndex: 0,
        toolCall: partial.content[0] as Extract<
          AssistantMessage["content"][number],
          { type: "toolCall"; }
        >,
        partial
      });
      stream.push({ type: "done", reason: "toolUse", message: partial });
    });
    return stream;
  }
  if (prompt === "increment") {
    const partial: AssistantMessage = {
      ..._partial(""),
      content: [{
        type: "toolCall",
        id: `increment-${crypto.randomUUID()}`,
        name: "increment",
        arguments: {}
      }],
      stopReason: "toolUse"
    };
    queueMicrotask(() => {
      stream.push({ type: "start", partial });
      stream.push({ type: "toolcall_start", contentIndex: 0, partial });
      stream.push({
        type: "toolcall_end",
        contentIndex: 0,
        toolCall: partial.content[0] as Extract<
          AssistantMessage["content"][number],
          { type: "toolCall"; }
        >,
        partial
      });
      stream.push({ type: "done", reason: "toolUse", message: partial });
    });
    return stream;
  }
  const text = prompt === "large-event"
    ? "x".repeat(1024 * 1024)
    : `reply:${String(context.messages.at(-1)?.role)}`;
  const partial = _partial(text);
  const publish = () => {
    stream.push({ type: "start", partial });
    stream.push({ type: "text_start", contentIndex: 0, partial });
    stream.push({ type: "text_delta", contentIndex: 0, delta: text, partial });
    stream.push({ type: "text_end", contentIndex: 0, content: text, partial });
    stream.push({ type: "done", reason: "stop", message: partial });
  };
  if (prompt === "slow") {
    setTimeout(publish, 200);
  } else {
    queueMicrotask(publish);
  }
  return stream;
}

function _userText(message: Context["messages"][number] | undefined): string {
  if (message?.role !== "user") {
    return "";
  }
  if (typeof message.content === "string") {
    return message.content;
  }
  return message.content
    .filter(content => content.type === "text")
    .map(content => content.text)
    .join("");
}

function _partial(text: string): AssistantMessage {
  return {
    role: "assistant",
    content: text ? [{ type: "text", text }] : [],
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
    timestamp: Date.now()
  };
}

function _disconnectFirstEventOnce(): typeof globalThis.fetch {
  let disconnect = true;
  return (async (
    input: Parameters<typeof globalThis.fetch>[0],
    init?: Parameters<typeof globalThis.fetch>[1]
  ) => {
    const response = await fetch(input, init);
    const url = typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
    if (!disconnect || !url.endsWith("/events") || !response.body) {
      return response;
    }
    disconnect = false;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        let buffered = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          buffered += decoder.decode(value, { stream: true });
          const boundary = buffered.indexOf("\n\n");
          if (boundary >= 0) {
            controller.enqueue(encoder.encode(buffered.slice(0, boundary + 2)));
            await reader.cancel("test disconnect");
            break;
          }
        }
        controller.error(new TypeError("test transport failure"));
      }
    });
    return new Response(body, {
      status: response.status,
      headers: response.headers
    });
  }) as typeof globalThis.fetch;
}

async function _directHttpStatus(
  value: string,
  headers: Readonly<Record<string, string>>,
  method = "GET"
): Promise<number> {
  const url = new URL(value);
  return new Promise<number>((resolveStatus, rejectStatus) => {
    const socket = createConnection({
      host: url.hostname,
      port: Number(url.port)
    }, () => {
      const requestHeaders = Object.entries(headers)
        .map(([name, value]) => `${name}: ${value}`)
        .join("\r\n");
      socket.write(
        `${method} ${url.pathname}${url.search} HTTP/1.1\r\n${requestHeaders}`
        + "\r\nConnection: close\r\n\r\n"
      );
    });
    let responseHead = "";
    socket.on("data", chunk => {
      responseHead += chunk.toString("utf8");
      const firstLineEnd = responseHead.indexOf("\r\n");
      if (firstLineEnd < 0) {
        return;
      }
      const match = /^HTTP\/1\.1 (\d{3}) /.exec(
        responseHead.slice(0, firstLineEnd)
      );
      socket.destroy();
      if (!match?.[1]) {
        rejectStatus(new Error("Expected a valid direct HTTP response"));
        return;
      }
      resolveStatus(Number(match[1]));
    });
    socket.on("error", rejectStatus);
  });
}
