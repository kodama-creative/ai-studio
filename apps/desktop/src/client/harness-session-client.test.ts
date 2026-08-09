import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ModelTurnEngine } from "@llm-space/harness";

import { openAgentProject } from "../bun/projects/agent-project";
import { createProjectSessionHost } from "../bun/projects/project-session-host";

import type { HarnessSessionClient } from "./harness-session-client";

const ROOTS: string[] = [];

afterEach(async () => {
  await Promise.all(
    ROOTS.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

test("client creates, runs, and reattaches a persisted project session", async () => {
  const project = await openAgentProject(await _project());
  const firstHost = await createProjectSessionHost({
    engine: TEXT_ENGINE,
    project,
  });
  const first: HarnessSessionClient = firstHost;

  const created = await first.createThread({ title: "First task" });
  const events = _untilWaiting(
    first.events(created.thread.sessionId, {
      afterSequence: created.snapshot.eventSequence,
    })
  );
  await first.send(created.thread.sessionId, "hello project");

  expect(await events).toContain("message.appended");
  expect(await first.snapshot(created.thread.sessionId)).toMatchObject({
    status: "waiting",
    messages: [
      { role: "user", content: "hello project" },
      { role: "assistant", content: "hello from project" },
    ],
  });

  const secondHost = await createProjectSessionHost({
    engine: TEXT_ENGINE,
    project,
  });
  const second: HarnessSessionClient = secondHost;
  expect(await second.listThreads()).toEqual([
    expect.objectContaining({
      id: created.thread.id,
      sessionId: created.thread.sessionId,
      title: "First task",
    }),
  ]);
  expect((await second.attachThread(created.thread.id)).snapshot.messages).toHaveLength(
    2
  );
});

test("project tools receive a sandbox rooted at the project directory", async () => {
  const project = await openAgentProject(await _project());
  const host = await createProjectSessionHost({
    engine: WORKING_DIRECTORY_ENGINE,
    project,
  });
  const client: HarnessSessionClient = host;
  const created = await client.createThread();
  const events = _untilWaiting(
    client.events(created.thread.sessionId, {
      afterSequence: created.snapshot.eventSequence,
    })
  );

  await client.send(created.thread.sessionId, "where are you running?");
  await events;

  expect(await client.snapshot(created.thread.sessionId)).toMatchObject({
    messages: [
      { role: "user" },
      { role: "assistant", toolCalls: [{ name: "working-directory" }] },
      {
        role: "tool",
        name: "working-directory",
        output: { type: "text", value: project.rootPath },
      },
      { role: "assistant", content: "done" },
    ],
  });
});

test("reattaching after an agent change requires a new thread", async () => {
  const project = await openAgentProject(await _project());
  const firstHost = await createProjectSessionHost({
    engine: TEXT_ENGINE,
    project,
  });
  const created = await firstHost.createThread();
  await writeFile(
    join(project.agentRoot, "instructions.md"),
    "The agent changed.\n"
  );
  const changedHost = await createProjectSessionHost({
    engine: TEXT_ENGINE,
    project,
  });

  expect(changedHost.attachThread(created.thread.id)).rejects.toThrow(
    "Start a new thread to use the current agent generation."
  );
});

const TEXT_ENGINE: ModelTurnEngine = {
  async *run() {
    await Promise.resolve();
    yield { type: "text.delta", delta: "hello from project" } as const;
    yield { type: "finish", reason: "stop" } as const;
  },
};

const WORKING_DIRECTORY_ENGINE: ModelTurnEngine = {
  async *run(input) {
    await Promise.resolve();
    if (input.messages.some((message) => message.role === "tool")) {
      yield { type: "text.delta", delta: "done" } as const;
      yield { type: "finish", reason: "stop" } as const;
      return;
    }
    yield {
      type: "tool.call",
      call: { id: "call-working-directory", name: "working-directory", input: {} },
    } as const;
    yield { type: "finish", reason: "tool-calls" } as const;
  },
};

async function _untilWaiting(
  events: AsyncIterable<{
    readonly event: { readonly type: string };
  }>
): Promise<string[]> {
  const types: string[] = [];
  for await (const event of events) {
    types.push(event.event.type);
    if (event.event.type === "session.waiting") return types;
  }
  throw new Error("Session event stream ended before waiting.");
}

async function _project(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "llm-space-session-project-"));
  ROOTS.push(root);
  await mkdir(join(root, "agent"), { recursive: true });
  await writeFile(
    join(root, "package.json"),
    `${JSON.stringify({ name: "session-project", private: true })}\n`
  );
  await writeFile(
    join(root, "agent", "agent.ts"),
    [
      'export default { model: "test/local" };',
      "",
    ].join("\n")
  );
  await writeFile(
    join(root, "agent", "instructions.md"),
    "Reply concisely.\n"
  );
  await mkdir(join(root, "agent", "tools"), { recursive: true });
  await writeFile(
    join(root, "agent", "tools", "working-directory.ts"),
    [
      "export default {",
      '  description: "Return the project working directory.",',
      '  inputSchema: { type: "object", additionalProperties: false },',
      "  async execute(_input, context) {",
      '    const result = await (await context.getSandbox()).run("pwd");',
      "    return result.stdout.trim();",
      "  },",
      "};",
      "",
    ].join("\n")
  );
  return root;
}
