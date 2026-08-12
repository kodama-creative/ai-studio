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
  const project = await _openProject(await _project());
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

test("project host steps and continues the same durable Run", async () => {
  const project = await _openProject(await _project());
  const client = await _host({
    runExecutor: STEP_EXECUTOR,
    project,
  });
  const created = await client.createThread();
  await client.saveDocument(created.id, {
    ...created.document,
    conversation: {
      messages: [
        {
          id: "user-step",
          role: "user",
          content: [{ type: "text", text: "step through this" }],
        },
      ],
      state: {},
    },
  });

  const receipt = await client.run(created.id, {
    fromMessageId: "user-step",
    mode: "step",
  });
  await _untilPaused(client.events(created.id), receipt.runId);
  const toolStep = await client.stepRun(receipt.runId, {
    toolCallId: "call-step",
  });
  expect(toolStep.runId).toBe(receipt.runId);
  await _untilPaused(client.events(created.id), receipt.runId, "tool.completed");
  const continued = await client.continueRun(receipt.runId);
  expect(continued.runId).toBe(receipt.runId);
  await _untilCompleted(client.events(created.id), receipt.runId);

  expect(await client.loadThread(created.id)).toMatchObject({
    document: {
      conversation: {
        messages: [
          { id: "user-step" },
          { toolCalls: [{ id: "call-step", output: {} }] },
          { content: [{ type: "text", text: "done stepping" }] },
        ],
      },
    },
  });
});

test("project tools receive Engine execution context and project sandbox", async () => {
  const project = await _openProject(await _project());
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
  const project = await _openProject(await _project());
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

test("dirty Agent source creates an unbound Experiment that reloads current code", async () => {
  const root = await _project();
  const project = await _openProject(root);
  await writeFile(
    join(project.agentRoot, "instructions.md"),
    "Dirty initial definition.\n"
  );
  const first = await _host({
    runExecutor: TEXT_EXECUTOR,
    project,
  });
  const created = await first.createThread();
  expect(created.document.commitId).toBeUndefined();
  await writeFile(
    join(project.agentRoot, "instructions.md"),
    "Dirty definition used by the next Run.\n"
  );
  await first.saveDocument(created.id, {
    ...created.document,
    conversation: {
      messages: [
        {
          id: "user-dirty",
          role: "user",
          content: [{ type: "text", text: "use current source" }],
        },
      ],
      state: {},
    },
  });
  const receipt = await first.run(created.id, {
    fromMessageId: "user-dirty",
  });
  await _untilCompleted(first.events(created.id), receipt.runId);
  const reloaded = await first.loadThread(created.id);
  expect(reloaded?.document.agent.instructions).toEqual([
    "Dirty definition used by the next Run.",
  ]);
  expect(reloaded?.document.agent.generationId).toBe("uncommitted");
});

test("clean Experiment binds HEAD and rejects a later source commit", async () => {
  const root = await _project();
  const project = await _openProject(root);
  const first = await _host({ runExecutor: TEXT_EXECUTOR, project });
  const created = await first.createThread();
  expect(created.document.commitId).toBeDefined();

  await writeFile(join(project.agentRoot, "instructions.md"), "Changed.\n");
  await _commit(root, "agent change");
  expect(first.run(created.id, { fromMessageId: "missing" })).rejects.toThrow(
    "Studio Thread is bound to commit"
  );
});

const TEXT_EXECUTOR: RunExecutor = {
  async executeStep(input, sink) {
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

const STEP_EXECUTOR: RunExecutor = {
  async executeStep(input, sink) {
    if (input.step.type === "tools") {
      const requested = input.messages.findLast(
        (message) => message.role === "assistant"
      );
      if (requested?.role !== "assistant") {
        throw new Error("Tool Step requires an Assistant Message.");
      }
      const completed = {
        ...requested,
        toolCalls: requested.toolCalls?.map((call) =>
          input.step.type === "tools" &&
          input.step.toolCallIds.includes(call.id)
            ? {
                ...call,
                output: {
                  content: [{ type: "text" as const, text: "tool output" }],
                  isError: false,
                },
              }
            : call
        ),
      };
      await sink.accept({
        type: "tool.started",
        messageId: requested.id,
        toolCallId: "call-step",
        toolName: "working-directory",
      });
      await sink.accept({
        type: "tool.completed",
        messageId: requested.id,
        toolCallId: "call-step",
        message: completed,
      });
      return;
    }
    const previous = input.messages.at(-1);
    const message =
      previous?.role === "assistant"
        ? {
            id: input.createMessageId(),
            role: "assistant" as const,
            content: [{ type: "text" as const, text: "done stepping" }],
          }
        : {
            id: input.createMessageId(),
            role: "assistant" as const,
            content: [],
            toolCalls: [
              {
                id: "call-step",
                input: { name: "working-directory", arguments: {} },
              },
            ],
          };
    await sink.accept({ type: "assistant.completed", message });
  },
};

const WORKING_DIRECTORY_EXECUTOR: RunExecutor = {
  async executeStep(input, sink, { signal }) {
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

async function _untilPaused(
  events: AsyncIterable<import("@llm-space/studio").StudioThreadEvent>,
  runId: string,
  step?: string
): Promise<void> {
  for await (const item of events) {
    if (
      item.event.type === "run.paused" &&
      item.event.run.id === runId &&
      (step === undefined || item.event.run.pause?.step === step)
    ) {
      return;
    }
  }
  throw new Error("Studio event stream ended before run pause.");
}

async function _host(
  options: CreateProjectStudioHostOptions
): Promise<ProjectStudioHost> {
  const host = await createProjectStudioHost(options);
  HOSTS.push(host);
  return host;
}

async function _openProject(root: string) {
  const homePath = await mkdtemp(join(tmpdir(), "llm-space-studio-home-"));
  ROOTS.push(homePath);
  return openAgentProject(root, { homePath });
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
