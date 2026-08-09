import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { RunExecutor } from "../../run";
import { createStudioThreadRuntime } from "../../studio";

import { createFileStudioStorage } from "./file-studio-storage";

test("file Studio storage keeps Thread, Run, and Checkpoint as separate resources", async () => {
  const root = await mkdtemp(join(tmpdir(), "llm-space-studio-storage-"));
  try {
    const storage = createFileStudioStorage(root);
    const executor: RunExecutor = {
      async *execute(input) {
        await Promise.resolve();
        yield {
          type: "message.completed",
          message: {
            id: "assistant-1",
            role: "assistant",
            content: [{ type: "text", text: "done" }],
            origin: { runId: input.runId },
          },
        };
      },
    };
    const ids = ["thread-1", "run-1", "checkpoint-1"];
    const runtime = createStudioThreadRuntime({
      ...storage,
      executor,
      revisionProvider: { current: () => Promise.resolve("commit-a") },
      clock: () => 10,
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
          {
            id: "user-1",
            role: "user",
            content: [{ type: "text", text: "go" }],
          },
        ],
        state: {},
      },
    });
    const receipt = await runtime.run(thread.id, { fromMessageId: "user-1" });
    for await (const event of runtime.events(thread.id, { follow: true })) {
      if (event.event.type === "run.completed") break;
    }
    const firstRun = await storage.runRepository.load(receipt.runId);
    if (firstRun === undefined) throw new Error("Run was not persisted.");
    await storage.runRepository.create({ ...firstRun, id: "run-2" });
    await storage.runIndexRepository.append({
      threadId: thread.id,
      runId: "run-2",
      relation: "inherited",
    });
    await runtime.saveEvaluationMetadata(thread.id, {
      evaluations: [
        {
          id: "evaluation-1",
          leftRunId: "run-1",
          rightRunId: "run-2",
          verdict: "leftBetter",
          createdAt: 10,
          updatedAt: 10,
        },
      ],
      rubrics: [],
    });

    const threadJson = JSON.parse(
      await readFile(join(root, "threads", "thread-1", "thread.json"), "utf8")
    ) as Record<string, unknown>;
    const runJson = JSON.parse(
      await readFile(join(root, "runs", receipt.runId + ".json"), "utf8")
    ) as Record<string, unknown>;
    const checkpointJson = JSON.parse(
      await readFile(
        join(
          root,
          "threads",
          "thread-1",
          "checkpoints",
          "checkpoint-1.json"
        ),
        "utf8"
      )
    ) as Record<string, unknown>;
    const evaluationJson = JSON.parse(
      await readFile(
        join(
          root,
          "threads",
          "thread-1",
          "evaluations",
          "evaluation-1.json"
        ),
        "utf8"
      )
    ) as Record<string, unknown>;

    expect(threadJson).not.toHaveProperty("runHistory");
    expect(threadJson).not.toHaveProperty("evaluations");
    expect(runJson).not.toHaveProperty("steps");
    expect(checkpointJson).toHaveProperty("source.runId", "run-1");
    expect(evaluationJson).toMatchObject({
      threadId: "thread-1",
      leftRunId: "run-1",
      rightRunId: "run-2",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("file Studio event logs identify malformed JSON by path and line", async () => {
  const root = await mkdtemp(join(tmpdir(), "llm-space-studio-events-"));
  try {
    const path = join(root, "threads", "thread-1", "events.jsonl");
    await mkdir(join(root, "threads", "thread-1"), { recursive: true });
    await writeFile(
      path,
      '{"threadId":"thread-1","sequence":1,"timestamp":1,"event":{"type":"run.completed","runId":"run-1"}}\n{broken\n'
    );
    const storage = createFileStudioStorage(root);

    let error: unknown;
    try {
      for await (const _event of storage.eventLog.read("thread-1")) {
        // Consume the public event stream to trigger decoding.
        void _event;
      }
    } catch (cause) {
      error = cause;
    }
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain(`line 2 in "${path}"`);
    expect((error as Error).cause).toBeInstanceOf(SyntaxError);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
