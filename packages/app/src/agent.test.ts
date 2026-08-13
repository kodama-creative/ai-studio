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

test("createAgent owns SQLite composition and reloads source for each new Run", async () => {
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
  const session = await first.createSession({ title: "Persistent" });
  const run = await first.startRun(session.id, {
    message: {
      id: "user-1",
      role: "user",
      content: [{ type: "text", text: "hello" }],
    },
  });
  await _untilTerminal(first.events(session.id, run.id, { follow: true }));
  expect(await first.listMessages(session.id)).toMatchObject([
    { type: "model", message: { role: "user" } },
    {
      type: "model",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "first answer" }],
      },
    },
  ]);

  await first.close();
  const second = await _agent({
    projectRoot,
    dataRoot,
    models,
    runtimeServices: {},
  });
  expect(await second.getSession(session.id)).toMatchObject({
    id: session.id,
    title: "Persistent",
  });
  expect(await second.listRuns(session.id)).toHaveLength(1);
});

async function _untilTerminal(
  frames: AsyncIterable<import("@llm-space/engine").RunFrame>
): Promise<void> {
  for await (const frame of frames) {
    if (
      frame.type === "event" &&
      frame.event.type === "run.updated" &&
      ["completed", "failed", "cancelled", "interrupted"].includes(
        frame.event.run.status
      )
    ) {
      return;
    }
  }
}

async function _agent(options: Parameters<typeof createAgent>[0]) {
  const agent = await createAgent(options);
  AGENTS.push(agent);
  return agent;
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
