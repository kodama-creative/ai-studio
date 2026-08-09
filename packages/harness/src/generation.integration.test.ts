import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadAgent } from "@llm-space/agent/loader";

import {
  createHarness,
  type ModelTurnEngine,
  type ModelTurnEvent,
} from "./index";

const ROOTS: string[] = [];

afterEach(async () => {
  await Promise.all(
    ROOTS.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

test("executes a generation produced by the code-first agent loader", async () => {
  const root = await mkdtemp(join(tmpdir(), "llm-space-harness-"));
  ROOTS.push(root);
  await mkdir(join(root, "agent", "tools"), { recursive: true });
  await mkdir(join(root, "node_modules", "@llm-space"), { recursive: true });
  await symlink(
    join(import.meta.dir, "..", "..", "agent"),
    join(root, "node_modules", "@llm-space", "agent"),
    "dir"
  );
  await writeFile(join(root, "package.json"), '{"name":"@fixture/harness"}');
  await writeFile(
    join(root, "agent", "agent.ts"),
    [
      'import { defineAgent } from "@llm-space/agent";',
      'export default defineAgent({ model: "fixture/model" });',
    ].join("\n")
  );
  await writeFile(
    join(root, "agent", "instructions.md"),
    "Use the authored tool."
  );
  await writeFile(
    join(root, "agent", "tools", "echo.ts"),
    [
      'import { defineTool, toolOutput } from "@llm-space/agent/tools";',
      "export default defineTool({",
      '  description: "Echo text",',
      '  inputSchema: { type: "object" },',
      "  execute(input) { return input.value; },",
      "  toModelOutput(output) { return toolOutput.text(String(output)); },",
      "});",
    ].join("\n")
  );

  const generation = await loadAgent({ startPath: root });
  const engine: ModelTurnEngine = {
    async *run(input): AsyncIterable<ModelTurnEvent> {
      await Promise.resolve();
      const result = input.messages.find((message) => message.role === "tool");
      if (result?.role === "tool") {
        yield { type: "text.delta", delta: String(result.output.value) };
        yield { type: "finish", reason: "stop" };
        return;
      }
      yield {
        type: "tool.call",
        call: { id: "echo-call", name: "echo", input: { value: "worked" } },
      };
      yield { type: "finish", reason: "tool-calls" };
    },
  };
  const harness = createHarness({ engine });
  const agent = await harness.prepare(generation);
  const session = await agent.createSession({ mode: "task" });

  await session.send({ message: "Run" });

  expect(await session.snapshot()).toMatchObject({
    agentId: "@fixture/harness",
    generationId: generation.sourceFingerprint,
    status: "completed",
    messages: [
      { role: "user", content: "Run" },
      { role: "assistant", toolCalls: [{ name: "echo" }] },
      {
        role: "tool",
        output: { type: "text", value: "worked" },
        isError: false,
      },
      { role: "assistant", content: "worked" },
    ],
  });
});
