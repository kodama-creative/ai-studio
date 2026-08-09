import { expect, test } from "bun:test";

import type { RunExecutor } from "../run/run-executor";

import { createInMemoryStudioStorage } from "./in-memory-studio-storage";
import {
  createStudioThreadRuntime,
  StudioThreadOutdatedError,
} from "./studio-thread-runtime";

test("a Studio run persists messages in a checkpoint without Run steps", async () => {
  const storage = createInMemoryStudioStorage();
  const executor: RunExecutor = {
    async *execute(input) {
      await Promise.resolve();
      yield {
        type: "message.completed",
        message: {
          id: "assistant-1",
          role: "assistant",
          content: [{ type: "text", text: "Hello from the agent" }],
          origin: { runId: input.runId },
        },
      };
    },
  };
  const runtime = createStudioThreadRuntime({
    ...storage,
    executor,
    revisionProvider: { current: () => Promise.resolve("commit-a") },
    clock: () => 42,
    generateId: (prefix) => `${prefix}-1`,
  });

  const thread = await runtime.createThread({
    title: "Greeting",
    agent: {
      schemaVersion: 1,
      agentId: "example-agent",
      generationId: "generation-a",
      model: "openai/gpt-5",
      instructions: ["Be helpful."],
      tools: [],
    },
    conversation: {
      messages: [
        {
          id: "user-1",
          role: "user",
          content: [{ type: "text", text: "Hello" }],
        },
      ],
      state: {},
    },
  });

  const receipt = await runtime.run(thread.id, {
    fromMessageId: "user-1",
  });
  for await (const event of runtime.events(thread.id, { follow: true })) {
    if (
      event.event.type === "run.completed" &&
      event.event.runId === receipt.runId
    ) {
      break;
    }
  }

  const completedRun = await storage.runRepository.load(receipt.runId);
  if (completedRun === undefined) throw new Error("Run was not persisted.");
  expect(completedRun?.status).toBe("completed");
  expect(completedRun).not.toHaveProperty("steps");
  expect(completedRun?.resultCheckpointId).toBe("checkpoint-1");

  const checkpoint = await storage.checkpointRepository.load("checkpoint-1");
  if (checkpoint === undefined)
    throw new Error("Checkpoint was not persisted.");
  expect(checkpoint?.document.conversation.messages).toEqual([
    {
      id: "user-1",
      role: "user",
      content: [{ type: "text", text: "Hello" }],
    },
    {
      id: "assistant-1",
      role: "assistant",
      content: [{ type: "text", text: "Hello from the agent" }],
      origin: { runId: "run-1" },
    },
  ]);
  expect(await runtime.listRunHistory(thread.id)).toEqual([
    {
      reference: {
        threadId: "thread-1",
        runId: "run-1",
        checkpointId: "checkpoint-1",
        relation: "executed",
      },
      run: completedRun,
      checkpoint,
    },
  ]);
});

test("running from an earlier message truncates the editable conversation", async () => {
  const storage = createInMemoryStudioStorage();
  let inputMessageIds: string[] = [];
  const runtime = createStudioThreadRuntime({
    ...storage,
    executor: {
      async *execute(input) {
        await Promise.resolve();
        inputMessageIds = input.conversation.messages.map(
          (message) => message.id
        );
        yield {
          type: "message.completed",
          message: {
            id: "new-assistant",
            role: "assistant",
            content: [{ type: "text", text: "new" }],
          },
        };
      },
    },
    revisionProvider: { current: () => Promise.resolve("commit-a") },
    generateId: (() => {
      const ids = ["thread-1", "run-1", "checkpoint-1"];
      return () => ids.shift()!;
    })(),
  });
  const thread = await runtime.createThread({
    agent: {
      schemaVersion: 1,
      agentId: "agent",
      generationId: "generation",
      model: "openai/gpt-5",
      instructions: [],
      tools: [],
    },
    conversation: {
      messages: [
        {
          id: "user-1",
          role: "user",
          content: [{ type: "text", text: "one" }],
        },
        {
          id: "assistant-old",
          role: "assistant",
          content: [{ type: "text", text: "old" }],
        },
        {
          id: "user-2",
          role: "user",
          content: [{ type: "text", text: "two" }],
        },
      ],
      state: {},
    },
  });
  const receipt = await runtime.run(thread.id, { fromMessageId: "user-1" });
  for await (const event of runtime.events(thread.id, { follow: true })) {
    if (
      event.event.type === "run.completed" &&
      event.event.runId === receipt.runId
    ) {
      break;
    }
  }

  expect(inputMessageIds).toEqual(["user-1"]);
  expect(
    (await runtime.loadThread(thread.id))?.document.conversation.messages.map(
      (message) => message.id
    )
  ).toEqual(["user-1", "new-assistant"]);
});

test("fork binds a historical Checkpoint to the current commit and Agent", async () => {
  const storage = createInMemoryStudioStorage();
  let commitId = "commit-a";
  const ids = ["thread-1", "run-1", "checkpoint-1", "thread-2"];
  const runtime = createStudioThreadRuntime({
    ...storage,
    executor: {
      async *execute() {
        await Promise.resolve();
        yield {
          type: "message.completed",
          message: {
            id: "assistant-1",
            role: "assistant",
            content: [{ type: "text", text: "first result" }],
          },
        };
      },
    },
    revisionProvider: { current: () => Promise.resolve(commitId) },
    resolveCurrentAgent: () =>
      Promise.resolve({
        snapshot: {
          schemaVersion: 1,
          agentId: "agent",
          generationId: "generation-b",
          model: "openai/gpt-5",
          instructions: ["new"],
          tools: [],
        },
        tools: new Map(),
      }),
    generateId: () => ids.shift()!,
  });
  const original = await runtime.createThread({
    agent: {
      schemaVersion: 1,
      agentId: "agent",
      generationId: "generation-a",
      model: "openai/gpt-5",
      instructions: ["old"],
      tools: [],
    },
    conversation: {
      messages: [
        { id: "user-1", role: "user", content: [{ type: "text", text: "go" }] },
      ],
      state: {},
    },
  });
  const receipt = await runtime.run(original.id, { fromMessageId: "user-1" });
  for await (const event of runtime.events(original.id, { follow: true })) {
    if (
      event.event.type === "run.completed" &&
      event.event.runId === receipt.runId
    ) {
      break;
    }
  }
  commitId = "commit-b";

  const fork = await runtime.forkThread(original.id, {
    checkpointId: "checkpoint-1",
  });

  expect(fork.document.commitId).toBe("commit-b");
  expect(fork.document.agent.generationId).toBe("generation-b");
  expect(fork.document.conversation.messages).toHaveLength(2);
  expect(await storage.runIndexRepository.list(fork.id)).toEqual([
    {
      threadId: "thread-2",
      runId: "run-1",
      checkpointId: "checkpoint-1",
      relation: "inherited",
    },
  ]);
});

test("Studio event sequences continue after the runtime restarts", async () => {
  const storage = createInMemoryStudioStorage();
  const executor: RunExecutor = {
    async *execute(input) {
      await Promise.resolve();
      yield {
        type: "message.completed",
        message: {
          id: `assistant-${input.runId}`,
          role: "assistant",
          content: [{ type: "text", text: "done" }],
        },
      };
    },
  };
  const ids = ["thread-1", "run-1", "checkpoint-1", "run-2", "checkpoint-2"];
  const options = {
    ...storage,
    executor,
    revisionProvider: { current: () => Promise.resolve("commit-a") },
    generateId: () => ids.shift()!,
  };
  const firstRuntime = createStudioThreadRuntime(options);
  const thread = await firstRuntime.createThread({
    agent: {
      schemaVersion: 1,
      agentId: "agent",
      generationId: "generation",
      model: "openai/gpt-5",
      instructions: [],
      tools: [],
    },
    conversation: {
      messages: [
        { id: "user-1", role: "user", content: [{ type: "text", text: "go" }] },
      ],
      state: {},
    },
  });
  const first = await firstRuntime.run(thread.id, { fromMessageId: "user-1" });
  for await (const event of firstRuntime.events(thread.id, { follow: true })) {
    if (
      event.event.type === "run.completed" &&
      event.event.runId === first.runId
    )
      break;
  }

  const secondRuntime = createStudioThreadRuntime(options);
  const second = await secondRuntime.run(thread.id, {
    fromMessageId: "user-1",
  });
  for await (const event of secondRuntime.events(thread.id, { follow: true })) {
    if (
      event.event.type === "run.completed" &&
      event.event.runId === second.runId
    )
      break;
  }

  const sequences: number[] = [];
  for await (const event of secondRuntime.events(thread.id)) {
    sequences.push(event.sequence);
  }
  expect(sequences).toEqual(sequences.map((_, index) => index + 1));
});

test("a restarted Studio runtime cancels an interrupted durable Run", async () => {
  const storage = createInMemoryStudioStorage();
  const runtime = createStudioThreadRuntime({
    ...storage,
    executor: {
      async *execute() {
        await Promise.resolve();
        yield _unusedRunOutput();
      },
    },
    revisionProvider: { current: () => Promise.resolve("commit-a") },
    generateId: () => "thread-1",
  });
  const thread = await runtime.createThread({
    agent: {
      schemaVersion: 1,
      agentId: "agent",
      generationId: "generation",
      model: "openai/gpt-5",
      instructions: [],
      tools: [],
    },
  });
  await storage.runRepository.create({
    schemaVersion: 1,
    id: "run-interrupted",
    owner: { type: "thread", threadId: thread.id },
    triggerMessageId: "user-1",
    status: "running",
    createdAt: 1,
    startedAt: 2,
  });
  await storage.threadRepository.save({
    ...thread,
    activeRunId: "run-interrupted",
  });

  const restarted = createStudioThreadRuntime({
    ...storage,
    executor: {
      async *execute() {
        await Promise.resolve();
        yield _unusedRunOutput();
      },
    },
    revisionProvider: { current: () => Promise.resolve("commit-a") },
    clock: () => 10,
  });

  expect(await restarted.loadThread(thread.id)).toMatchObject({
    activeRunId: undefined,
  });
  expect(await storage.runRepository.load("run-interrupted")).toMatchObject({
    status: "cancelled",
    completedAt: 10,
  });
  expect(await storage.runIndexRepository.list(thread.id)).toEqual([
    {
      threadId: thread.id,
      runId: "run-interrupted",
      relation: "executed",
    },
  ]);
});

test("Studio document saves cannot rewrite the bound Agent or commit", async () => {
  const storage = createInMemoryStudioStorage();
  const runtime = createStudioThreadRuntime({
    ...storage,
    executor: {
      async *execute() {
        await Promise.resolve();
        yield _unusedRunOutput();
      },
    },
    revisionProvider: { current: () => Promise.resolve("commit-a") },
  });
  const thread = await runtime.createThread({
    agent: {
      schemaVersion: 1,
      agentId: "agent",
      generationId: "generation-a",
      model: "openai/gpt-5",
      instructions: ["original"],
      tools: [],
    },
  });

  const saved = await runtime.saveDocument(thread.id, {
    ...thread.document,
    title: "Editable",
    agent: {
      ...thread.document.agent,
      generationId: "forged-generation",
      instructions: ["forged"],
    },
    commitId: "forged-commit",
  });

  expect(saved.document).toMatchObject({
    title: "Editable",
    agent: {
      generationId: "generation-a",
      instructions: ["original"],
    },
    commitId: "commit-a",
  });
});

test("Studio execution rejects a HEAD change while resolving the Agent", async () => {
  const storage = createInMemoryStudioStorage();
  let commitId = "commit-a";
  const runtime = createStudioThreadRuntime({
    ...storage,
    executor: {
      async *execute() {
        await Promise.resolve();
        yield _unusedRunOutput();
      },
    },
    revisionProvider: { current: () => Promise.resolve(commitId) },
    resolveAgent: (snapshot) => {
      commitId = "commit-b";
      return Promise.resolve({ snapshot, tools: new Map() });
    },
  });
  const thread = await runtime.createThread({
    agent: {
      schemaVersion: 1,
      agentId: "agent",
      generationId: "generation-a",
      model: "openai/gpt-5",
      instructions: [],
      tools: [],
    },
    conversation: {
      messages: [
        { id: "user-1", role: "user", content: [{ type: "text", text: "go" }] },
      ],
      state: {},
    },
  });

  expect(runtime.run(thread.id, { fromMessageId: "user-1" })).rejects.toThrow(
    StudioThreadOutdatedError
  );
  expect(
    await storage.runRepository.listByOwner({
      type: "thread",
      threadId: thread.id,
    })
  ).toEqual([]);
});

test("Studio evaluations are stored as metadata resources outside the Thread", async () => {
  const storage = createInMemoryStudioStorage();
  const ids = ["thread-1", "run-1", "checkpoint-1"];
  const runtime = createStudioThreadRuntime({
    ...storage,
    executor: {
      async *execute() {
        await Promise.resolve();
        yield {
          type: "message.completed",
          message: {
            id: "assistant-1",
            role: "assistant",
            content: [{ type: "text", text: "done" }],
          },
        };
      },
    },
    revisionProvider: { current: () => Promise.resolve("commit-a") },
    generateId: () => ids.shift()!,
  });
  const thread = await runtime.createThread({
    agent: {
      schemaVersion: 1,
      agentId: "agent",
      generationId: "generation",
      model: "openai/gpt-5",
      instructions: [],
      tools: [],
    },
    conversation: {
      messages: [
        { id: "user-1", role: "user", content: [{ type: "text", text: "go" }] },
      ],
      state: {},
    },
  });
  const first = await runtime.run(thread.id, { fromMessageId: "user-1" });
  for await (const event of runtime.events(thread.id, { follow: true })) {
    if (
      event.event.type === "run.completed" &&
      event.event.runId === first.runId
    )
      break;
  }
  const secondRun = {
    ...(await storage.runRepository.load(first.runId))!,
    id: "run-2",
  };
  await storage.runRepository.create(secondRun);
  await storage.runIndexRepository.append({
    threadId: thread.id,
    runId: secondRun.id,
    relation: "inherited",
  });

  await runtime.saveEvaluationMetadata(thread.id, {
    evaluations: [
      {
        id: "evaluation-1",
        leftRunId: first.runId,
        rightRunId: secondRun.id,
        verdict: "leftBetter",
        note: "First is clearer.",
        createdAt: 20,
        updatedAt: 20,
      },
    ],
    rubrics: [
      {
        id: "rubric-1",
        name: "Quality",
        criteria: [
          { id: "clarity", name: "Clarity" },
          { id: "accuracy", name: "Accuracy" },
        ],
        revision: 1,
        createdAt: 20,
        updatedAt: 20,
      },
    ],
  });

  expect(await runtime.listEvaluationMetadata(thread.id)).toEqual({
    evaluations: [
      {
        schemaVersion: 1,
        threadId: thread.id,
        id: "evaluation-1",
        leftRunId: first.runId,
        rightRunId: secondRun.id,
        verdict: "leftBetter",
        note: "First is clearer.",
        createdAt: 20,
        updatedAt: 20,
      },
    ],
    rubrics: [
      {
        schemaVersion: 1,
        threadId: thread.id,
        id: "rubric-1",
        name: "Quality",
        criteria: [
          { id: "clarity", name: "Clarity" },
          { id: "accuracy", name: "Accuracy" },
        ],
        revision: 1,
        createdAt: 20,
        updatedAt: 20,
      },
    ],
  });
  expect(await runtime.loadThread(thread.id)).not.toHaveProperty("evaluations");

  await runtime.saveRunHistory(thread.id, [first.runId]);
  expect(
    (await runtime.listRunHistory(thread.id)).map((entry) => entry.run.id)
  ).toEqual([first.runId]);
  expect((await runtime.listEvaluationMetadata(thread.id)).evaluations).toEqual(
    []
  );
});

function _unusedRunOutput() {
  return {
    type: "message.completed" as const,
    message: {
      id: "unused-assistant",
      role: "assistant" as const,
      content: [],
    },
  };
}
