import { afterEach, expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import type { ModelTurnEngine } from "@llm-space/harness";

import { openAgentProject } from "../bun/projects/agent-project";
import { createProjectStudioHost } from "../bun/projects/project-studio-host";

import type { ProjectStudioClient } from "./project-studio-client";

const exec = promisify(execFile);
const ROOTS: string[] = [];

afterEach(async () => {
  await Promise.all(
    ROOTS.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

test("client creates, runs, and reattaches an independent Studio Thread", async () => {
  const project = await openAgentProject(await _project());
  const first: ProjectStudioClient = await createProjectStudioHost({
    engine: TEXT_ENGINE,
    project,
  });
  const created = await first.createThread({ title: "First task" });
  const document = {
    ...created.document,
    conversation: {
      ...created.document.conversation,
      messages: [
        {
          id: "user-1",
          role: "user" as const,
          content: [{ type: "text" as const, text: "hello project" }],
        },
      ],
    },
  };
  await first.saveDocument(created.id, document);
  const receipt = await first.run(created.id, { fromMessageId: "user-1" });
  expect(
    await _untilCompleted(first.events(created.id), receipt.runId)
  ).toContain("message.delta");

  expect(await first.loadThread(created.id)).toMatchObject({
    document: {
      conversation: {
        messages: [
          { role: "user", content: [{ type: "text", text: "hello project" }] },
          {
            role: "assistant",
            content: [{ type: "text", text: "hello from project" }],
          },
        ],
      },
    },
  });

  const second: ProjectStudioClient = await createProjectStudioHost({
    engine: TEXT_ENGINE,
    project,
  });
  expect(await second.listThreads()).toEqual([
    expect.objectContaining({ id: created.id }),
  ]);
  expect(
    (await second.loadThread(created.id))?.document.conversation.messages
  ).toHaveLength(2);
});

test("project tools receive a synthetic Studio session and project sandbox", async () => {
  const project = await openAgentProject(await _project());
  const client: ProjectStudioClient = await createProjectStudioHost({
    engine: WORKING_DIRECTORY_ENGINE,
    project,
  });
  const created = await client.createThread();
  await client.saveDocument(created.id, {
    ...created.document,
    conversation: {
      messages: [
        {
          id: "user-1",
          role: "user",
          content: [{ type: "text", text: "where are you running?" }],
        },
      ],
      state: {},
    },
  });
  const receipt = await client.run(created.id, { fromMessageId: "user-1" });
  await _untilCompleted(client.events(created.id), receipt.runId);

  const messages =
    (await client.loadThread(created.id))?.document.conversation.messages ?? [];
  expect(messages).toMatchObject([
    { role: "user" },
    {
      role: "assistant",
      toolCalls: [
        {
          name: "working-directory",
          result: {
            output: { type: "text", value: project.rootPath },
            isError: false,
          },
        },
      ],
    },
    { role: "assistant", content: [{ type: "text", text: "done" }] },
  ]);
});

test("project Evaluation metadata survives host restart outside the Thread document", async () => {
  const project = await openAgentProject(await _project());
  const first: ProjectStudioClient = await createProjectStudioHost({
    engine: TEXT_ENGINE,
    project,
  });
  const thread = await first.createThread();
  await first.saveDocument(thread.id, {
    ...thread.document,
    conversation: {
      messages: [
        {
          id: "user-1",
          role: "user",
          content: [{ type: "text", text: "compare" }],
        },
      ],
      state: {},
    },
  });
  const left = await first.run(thread.id, { fromMessageId: "user-1" });
  await _untilCompleted(first.events(thread.id), left.runId);
  const right = await first.run(thread.id, { fromMessageId: "user-1" });
  await _untilCompleted(first.events(thread.id), right.runId);
  await first.saveEvaluationMetadata(thread.id, {
    evaluations: [
      {
        id: "evaluation-1",
        leftRunId: left.runId,
        rightRunId: right.runId,
        verdict: "tie",
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    rubrics: [],
  });

  const second: ProjectStudioClient = await createProjectStudioHost({
    engine: TEXT_ENGINE,
    project,
  });
  expect(await second.listEvaluationMetadata(thread.id)).toMatchObject({
    evaluations: [
      {
        id: "evaluation-1",
        threadId: thread.id,
        leftRunId: left.runId,
        rightRunId: right.runId,
      },
    ],
  });
  expect(await second.loadThread(thread.id)).not.toHaveProperty("evaluations");
});

test("uncommitted Agent changes are ignored but a new HEAD blocks execution", async () => {
  const root = await _project();
  const project = await openAgentProject(root);
  const first = await createProjectStudioHost({ engine: TEXT_ENGINE, project });
  const created = await first.createThread();
  await writeFile(
    join(project.agentRoot, "instructions.md"),
    "Dirty change.\n"
  );

  expect(await first.loadThread(created.id)).toBeDefined();

  await _commit(root, "agent change");
  expect(first.run(created.id, { fromMessageId: "missing" })).rejects.toThrow(
    "Studio Thread is bound to commit"
  );

  const current = await first.createThread();
  const { stdout: head } = await exec("git", ["-C", root, "rev-parse", "HEAD"]);
  expect(current.document.commitId).toBe(head.trim());
  expect(current.document.agent.generationId).not.toBe(
    created.document.agent.generationId
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
      call: {
        id: "call-working-directory",
        name: "working-directory",
        input: {},
      },
    } as const;
    yield { type: "finish", reason: "tool-calls" } as const;
  },
};

async function _untilCompleted(
  events: AsyncIterable<{
    readonly event: { readonly type: string; readonly runId?: string };
  }>,
  runId: string
): Promise<string[]> {
  const types: string[] = [];
  for await (const event of events) {
    types.push(event.event.type);
    if (event.event.type === "run.completed" && event.event.runId === runId) {
      return types;
    }
  }
  throw new Error("Studio event stream ended before run completion.");
}

async function _project(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "llm-space-studio-project-"));
  ROOTS.push(root);
  await mkdir(join(root, "agent", "tools"), { recursive: true });
  await writeFile(
    join(root, "package.json"),
    `${JSON.stringify({ name: "studio-project", private: true })}\n`
  );
  await writeFile(
    join(root, "agent", "agent.ts"),
    'export default { model: "test/local" };\n'
  );
  await writeFile(join(root, "agent", "instructions.md"), "Reply concisely.\n");
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
