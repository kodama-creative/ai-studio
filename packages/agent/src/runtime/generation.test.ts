import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadAgent } from "../loader";

import {
  resolveAgentGeneration,
  resolveAgentOperation,
} from "./generation";

test("resolves dynamic model and instructions once for an operation context", async () => {
  const root = await mkdtemp(join(tmpdir(), "llm-space-agent-dynamic-"));
  try {
    await mkdir(join(root, "agent"), { recursive: true });
    await writeFile(
      join(root, "package.json"),
      `${JSON.stringify({ name: "dynamic-agent", private: true })}\n`
    );
    await writeFile(
      join(root, "agent", "agent.ts"),
      `export default {
        model: {
          kind: "llm-space:dynamic",
          fallback: "openai/fallback",
          events: {
            "turn.started": (_event, ctx) =>
              ctx.session.id === "session-dynamic"
                ? { model: "anthropic/claude-dynamic" }
                : null,
          },
        },
      };\n`
    );
    await writeFile(
      join(root, "agent", "instructions.ts"),
      `export default {
        kind: "llm-space:dynamic",
        fallback: { markdown: "Fallback instructions" },
        events: {
          "turn.started": (event, ctx) => ({
            markdown: \`Run \${event.operationId} for \${ctx.session.id}\`,
          }),
        },
      };\n`
    );

    const prepared = await resolveAgentGeneration(
      await loadAgent({ startPath: root })
    );
    const resolved = await resolveAgentOperation(prepared, {
      sessionId: "session-dynamic",
      operationId: "operation-1",
      messages: [{ role: "user", content: "hello" }],
    });

    expect(resolved.model).toBe("anthropic/claude-dynamic");
    expect(resolved.instructions).toEqual([
      "Run operation-1 for session-dynamic",
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("loads mounted skills independently from the Pi execution binding", async () => {
  const root = await mkdtemp(join(tmpdir(), "llm-space-agent-skill-"));
  try {
    await mkdir(join(root, "agent", "skills", "review"), { recursive: true });
    await writeFile(
      join(root, "package.json"),
      `${JSON.stringify({ name: "skill-agent", private: true })}\n`
    );
    await writeFile(
      join(root, "agent", "agent.ts"),
      'export default { model: "openai/gpt-5" };\n'
    );
    await writeFile(
      join(root, "agent", "instructions.md"),
      "Use mounted capabilities.\n"
    );
    await writeFile(
      join(root, "agent", "skills", "review", "SKILL.md"),
      "---\ndescription: Review code carefully\n---\nFollow the checklist.\n"
    );

    const prepared = await resolveAgentGeneration(
      await loadAgent({ startPath: root })
    );
    const resolved = await resolveAgentOperation(prepared, {
      sessionId: "session-skill",
      operationId: "operation-skill",
      messages: [],
    });

    expect(resolved.skills.get("review")).toEqual({
      name: "review",
      description: "Review code carefully",
      markdown: "Follow the checklist.",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
