import { afterEach, expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";

import { createStudio, type Studio } from "./studio";

const exec = promisify(execFile);
const ROOTS: string[] = [];
const STUDIOS: Studio[] = [];

afterEach(async () => {
  await Promise.all(STUDIOS.splice(0).map((studio) => studio.close()));
  await Promise.all(
    ROOTS.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

test("createStudio owns Project source and SQLite recovery", async () => {
  const projectRoot = await _project();
  const dataRoot = await _temp("llm-space-studio-data-");
  const faux = fauxProvider({ tokensPerSecond: 0 });
  const model = faux.getModel();
  const models = createModels();
  models.setProvider(faux.provider);
  await writeFile(
    join(projectRoot, "agent", "agent.ts"),
    `export default { model: "${model.provider}/${model.id}" };\n`
  );
  await _commit(projectRoot, "model");

  const first = await _studio({
    projectRoot,
    dataRoot,
    models,
    runtimeServices: {},
  });
  expect(
    (await first.listSourceFiles()).some((node) => node.name === "agent")
  ).toBeTrue();
  expect(await first.readSourceFile("agent/instructions.md")).toBe(
    "Reply concisely.\n"
  );
  const thread = await first.createThread({ title: "Experiment" });
  expect(typeof thread.sessionId).toBe("string");
  expect(thread).toMatchObject({
    lane: "main",
  });

  await first.close();
  const second = await _studio({
    projectRoot,
    dataRoot,
    models,
    runtimeServices: {},
  });
  expect(await second.listThreads()).toEqual([
    expect.objectContaining({ id: thread.id }),
  ]);
});

test("a new Run reloads dirty current source instead of requiring a clean commit", async () => {
  const projectRoot = await _project();
  const dataRoot = await _temp("llm-space-studio-data-");
  const faux = fauxProvider({ tokensPerSecond: 0 });
  const model = faux.getModel();
  const models = createModels();
  models.setProvider(faux.provider);
  faux.setResponses([fauxAssistantMessage("Current source loaded.")]);
  await writeFile(
    join(projectRoot, "agent", "agent.ts"),
    `export default { model: "${model.provider}/${model.id}" };\n`
  );
  await _commit(projectRoot, "model");

  const studio = await _studio({
    projectRoot,
    dataRoot,
    models,
    runtimeServices: {},
  });
  const thread = await studio.createThread({ title: "Live source" });
  await writeFile(
    join(projectRoot, "agent", "instructions.md"),
    "Use the current dirty source.\n"
  );
  const saved = await studio.saveDocument(thread.id, {
    ...thread.document,
    conversation: {
      messages: [
        {
          id: "user-current-source",
          role: "user",
          content: [{ type: "text", text: "Which source is active?" }],
        },
      ],
      state: {},
    },
  });

  const receipt = await studio.run(saved.id, {
    fromMessageId: "user-current-source",
    mode: "continue",
  });
  expect(await _terminalEvent(studio, saved.id, receipt.operationId)).toBe(
    "operation.completed"
  );
  const loadedAgent = (await studio.loadThread(saved.id))?.document.agent;
  expect(typeof loadedAgent?.sourceRevision).toBe("string");
  expect(loadedAgent).toMatchObject({
    instructions: ["Use the current dirty source."],
  });
});

test("a source-defined Agent tool executes inside one continued Studio Run", async () => {
  const projectRoot = await _project();
  const dataRoot = await _temp("llm-space-studio-data-");
  const faux = fauxProvider({ tokensPerSecond: 0 });
  const model = faux.getModel();
  const models = createModels();
  models.setProvider(faux.provider);
  faux.setResponses([
    fauxAssistantMessage(
      [fauxToolCall("word-count", { text: "one two" }, { id: "call-1" })],
      { stopReason: "toolUse" }
    ),
    fauxAssistantMessage("The count is 2."),
  ]);
  await writeFile(
    join(projectRoot, "agent", "agent.ts"),
    `export default { model: "${model.provider}/${model.id}" };\n`
  );
  await mkdir(join(projectRoot, "agent", "tools"), { recursive: true });
  await writeFile(
    join(projectRoot, "agent", "tools", "word-count.ts"),
    [
      "export default {",
      '  description: "Count words.",',
      '  inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },',
      "  execute(input) { return { count: String(input.text).split(/\\s+/u).length }; },",
      "};",
      "",
    ].join("\n")
  );

  const studio = await _studio({
    projectRoot,
    dataRoot,
    models,
    runtimeServices: {},
  });
  const thread = await studio.createThread({ title: "Tool loop" });
  const saved = await studio.saveDocument(thread.id, {
    ...thread.document,
    conversation: {
      messages: [
        {
          id: "user-tool",
          role: "user",
          content: [{ type: "text", text: "Count one two" }],
        },
      ],
      state: {},
    },
  });

  const receipt = await studio.run(saved.id, {
    fromMessageId: "user-tool",
    mode: "continue",
  });
  expect(await _terminalEvent(studio, saved.id, receipt.operationId)).toBe(
    "operation.completed"
  );
  const messages = (await studio.loadThread(saved.id))?.document.conversation
    .messages;
  const toolMessage = messages?.find(
    (message) => message.role === "assistant" && message.toolCalls?.length
  );
  const finalMessage = messages?.at(-1);
  expect(toolMessage).toMatchObject({
    role: "assistant",
    toolCalls: [
      {
        id: "call-1",
        output: {
          content: [{ type: "text", text: '{"count":2}' }],
          isError: false,
        },
      },
    ],
  });
  expect(finalMessage).toMatchObject({
    role: "assistant",
    content: [{ type: "text", text: "The count is 2." }],
  });
});

/** Wait for the durable Studio projection and return this Run's terminal event. */
async function _terminalEvent(
  studio: Studio,
  threadId: string,
  operationId: string
): Promise<"operation.completed" | "operation.failed" | "operation.aborted"> {
  for await (const item of studio.events(threadId)) {
    if (
      (item.event.type === "operation.completed" ||
        item.event.type === "operation.failed" ||
        item.event.type === "operation.aborted") &&
      item.event.operationId === operationId
    ) {
      return item.event.type;
    }
  }
  throw new Error(
    `Operation "${operationId}" did not produce a terminal event.`
  );
}

async function _studio(options: Parameters<typeof createStudio>[0]) {
  const studio = await createStudio(options);
  STUDIOS.push(studio);
  return studio;
}

async function _project(): Promise<string> {
  const root = await _temp("llm-space-studio-project-");
  await mkdir(join(root, "agent"), { recursive: true });
  await writeFile(
    join(root, "package.json"),
    `${JSON.stringify({ name: "test-studio", private: true })}\n`
  );
  await writeFile(join(root, "agent", "agent.ts"), "export default {};\n");
  await writeFile(join(root, "agent", "instructions.md"), "Reply concisely.\n");
  await exec("git", ["init", root]);
  await exec("git", ["-C", root, "config", "user.email", "test@example.com"]);
  await exec("git", ["-C", root, "config", "user.name", "Test"]);
  await _commit(root, "initial");
  return root;
}

async function _commit(root: string, message: string): Promise<void> {
  await exec("git", ["-C", root, "add", "."]);
  await exec("git", ["-C", root, "commit", "-m", message]);
}

async function _temp(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  ROOTS.push(root);
  return root;
}
