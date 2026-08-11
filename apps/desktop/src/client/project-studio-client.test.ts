import { afterEach, expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import type { RunExecutor } from "@llm-space/engine";

import { openAgentProject } from "../bun/projects/agent-project";
import {
  createProjectStudioHost,
  type CreateProjectStudioHostOptions,
  type ProjectStudioHost,
} from "../bun/projects/project-studio-host";

const exec = promisify(execFile);
const ROOTS: string[] = [];
const HOSTS: ProjectStudioHost[] = [];

afterEach(async () => {
  await Promise.all(HOSTS.splice(0).map((host) => host.close()));
  await Promise.all(
    ROOTS.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

test("client creates, runs, and reattaches an independent Studio Thread", async () => {
  const project = await openAgentProject(await _project());
  const first = await _host({
    runExecutor: TEXT_EXECUTOR,
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

  await first.close();
  const second = await _host({
    runExecutor: TEXT_EXECUTOR,
    project,
  });
  expect(await second.listThreads()).toEqual([
    expect.objectContaining({ id: created.id }),
  ]);
  expect(
    (await second.loadThread(created.id))?.document.conversation.messages
  ).toHaveLength(2);
});

test("project tools receive Engine execution context and project sandbox", async () => {
  const project = await openAgentProject(await _project());
  const client = await _host({
    runExecutor: WORKING_DIRECTORY_EXECUTOR,
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
          input: { name: "working-directory" },
          output: {
            content: [{ type: "text", text: project.rootPath }],
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
  const first = await _host({
    runExecutor: TEXT_EXECUTOR,
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

  await first.close();
  const second = await _host({
    runExecutor: TEXT_EXECUTOR,
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
  const first = await _host({
    runExecutor: TEXT_EXECUTOR,
    project,
  });
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

const TEXT_EXECUTOR: RunExecutor = {
  async execute(input, sink) {
    const message = {
      id: input.createMessageId(),
      role: "assistant" as const,
      content: [{ type: "text" as const, text: "hello from project" }],
    };
    await sink.accept({
      type: "assistant.delta",
      message,
      textDelta: "hello from project",
    });
    await sink.accept({ type: "assistant.completed", message });
  },
};

const WORKING_DIRECTORY_EXECUTOR: RunExecutor = {
  async execute(input, sink, { signal }) {
    const requested = {
      id: input.createMessageId(),
      role: "assistant" as const,
      content: [],
      toolCalls: [
        {
          id: "call-working-directory",
          input: { name: "working-directory", arguments: {} },
        },
      ],
    };
    await sink.accept({ type: "assistant.completed", message: requested });
    await sink.accept({
      type: "tool.started",
      messageId: requested.id,
      toolCallId: "call-working-directory",
      toolName: "working-directory",
    });
    const prepared = input.agent.tools.get("working-directory");
    if (prepared === undefined) {
      throw new Error("working-directory was not found");
    }
    const value = await prepared.definition.execute(
      {},
      input.createToolContext({
        execution: {
          threadId: input.threadId,
          runId: input.runId,
          stepIndex: 0,
          callId: "call-working-directory",
          toolName: "working-directory",
        },
        signal,
      })
    );
    const withOutput = {
      ...requested,
      toolCalls: [
        {
          ...requested.toolCalls[0],
          output: {
            content: [{ type: "text" as const, text: String(value) }],
            isError: false,
          },
        },
      ],
    };
    await sink.accept({
      type: "tool.completed",
      messageId: requested.id,
      toolCallId: "call-working-directory",
      message: withOutput,
    });
    const answer = {
      id: input.createMessageId(),
      role: "assistant" as const,
      content: [{ type: "text" as const, text: "done" }],
    };
    await sink.accept({
      type: "assistant.delta",
      message: answer,
      textDelta: "done",
    });
    await sink.accept({ type: "assistant.completed", message: answer });
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

async function _host(
  options: CreateProjectStudioHostOptions
): Promise<ProjectStudioHost> {
  const host = await createProjectStudioHost(options);
  HOSTS.push(host);
  return host;
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
