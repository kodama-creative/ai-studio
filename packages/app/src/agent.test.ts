import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
} from "@earendil-works/pi-ai";

import { createAgent, type Agent } from "./agent";

const ROOTS: string[] = [];
const AGENTS: Agent[] = [];

afterEach(async () => {
  await Promise.all(AGENTS.splice(0).map((agent) => agent.close()));
  await Promise.all(
    ROOTS.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

test("createAgent persists only Pi Session truth and reloads current source", async () => {
  const projectRoot = await _project();
  const dataRoot = await _temp("llm-space-agent-data-");
  const faux = fauxProvider({ tokensPerSecond: 0 });
  const model = faux.getModel();
  const models = createModels();
  models.setProvider(faux.provider);
  await writeFile(
    join(projectRoot, "agent", "agent.ts"),
    `export default { model: "${model.provider}/${model.id}" };\n`
  );
  faux.setResponses([fauxAssistantMessage("first answer")]);
  const first = await _agent({
    projectRoot,
    dataRoot,
    models,
    runtimeServices: {},
  });
  const session = await first.createSession({ name: "Persistent" });
  const result = await first.exec(session.sessionId, {
    operationId: "operation-1",
    messages: [{ role: "user", content: "hello", timestamp: 1 }],
  });
  expect(result).toMatchObject({
    schemaVersion: 2,
    operation: { operationId: "operation-1", status: "completed" },
    messages: [
      { role: "user", content: "hello" },
      {
        role: "assistant",
        content: [{ type: "text", text: "first answer" }],
      },
    ],
  });
  expect(await first.listEntries(session.sessionId)).toMatchObject([
    { type: "message", message: { role: "user" } },
    { type: "message", message: { role: "assistant" } },
  ]);

  await first.close();
  const second = await _agent({
    projectRoot,
    dataRoot,
    models,
    runtimeServices: {},
  });
  expect(await second.getSession(session.sessionId)).toMatchObject({
    sessionId: session.sessionId,
    name: "Persistent",
  });
  expect(await second.listOperations(session.sessionId)).toMatchObject([
    { operationId: "operation-1", status: "completed" },
  ]);
  await second.abort(session.sessionId);
});

test("createAgent rejects source reload when the Agent identity changes", async () => {
  const projectRoot = await _project();
  const dataRoot = await _temp("llm-space-agent-identity-");
  const faux = fauxProvider({ tokensPerSecond: 0 });
  const model = faux.getModel();
  const models = createModels();
  models.setProvider(faux.provider);
  await writeFile(
    join(projectRoot, "agent", "agent.ts"),
    `export default { model: "${model.provider}/${model.id}" };\n`
  );
  const agent = await _agent({ projectRoot, dataRoot, models, runtimeServices: {} });
  const session = await agent.createSession();
  await writeFile(
    join(projectRoot, "package.json"),
    `${JSON.stringify({ name: "changed-agent", private: true })}\n`
  );

  const error = await _captureError(() =>
    agent.exec(session.sessionId, {
      operationId: "identity-change",
      messages: [{ role: "user", content: "hello", timestamp: 1 }],
    })
  );
  expect(error).toBeInstanceOf(Error);
  expect(String(error)).toContain("Agent identity changed");
  expect(await agent.listOperations(session.sessionId)).toEqual([]);
});

test("createAgent rejects durable Sessions owned by a previous Agent identity", async () => {
  const projectRoot = await _project();
  const dataRoot = await _temp("llm-space-agent-reopen-identity-");
  const models = createModels();
  await writeFile(
    join(projectRoot, "agent", "agent.ts"),
    'export default { model: "test/local" };\n'
  );
  const first = await _agent({
    projectRoot,
    dataRoot,
    models,
    runtimeServices: {},
  });
  const session = await first.createSession();
  const originalAgentId = first.agentId;
  await first.close();
  await writeFile(
    join(projectRoot, "package.json"),
    `${JSON.stringify({ name: "replacement-agent", private: true })}\n`
  );

  const replacement = await _agent({
    projectRoot,
    dataRoot,
    models,
    runtimeServices: {},
  });
  expect(replacement.agentId).not.toBe(originalAgentId);
  const error = await _captureError(() =>
    replacement.exec(session.sessionId, {
      operationId: "must-not-run",
      messages: [{ role: "user", content: "hello", timestamp: 1 }],
    })
  );
  expect(error).toBeInstanceOf(Error);
  expect(String(error)).toContain(
    `belongs to Agent "${originalAgentId}", not "${replacement.agentId}"`
  );
});

async function _agent(options: Parameters<typeof createAgent>[0]) {
  const agent = await createAgent(options);
  AGENTS.push(agent);
  return agent;
}

async function _captureError(
  operation: () => unknown
): Promise<unknown> {
  try {
    await operation();
    return undefined;
  } catch (error: unknown) {
    return error;
  }
}

async function _project(): Promise<string> {
  const root = await _temp("llm-space-agent-project-");
  await mkdir(join(root, "agent"), { recursive: true });
  await writeFile(
    join(root, "package.json"),
    `${JSON.stringify({ name: "test-agent", private: true })}\n`
  );
  await writeFile(join(root, "agent", "agent.ts"), "export default {};\n");
  await writeFile(join(root, "agent", "instructions.md"), "Reply concisely.\n");
  return root;
}

async function _temp(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  ROOTS.push(root);
  return root;
}
