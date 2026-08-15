import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadAgent } from "../loader";

import {
  mountAgentFrameworkTools,
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
    expect(resolved.instructions).toEqual(["Use mounted capabilities."]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("renders the default Skills variable only where authored", async () => {
  const root = await mkdtemp(join(tmpdir(), "llm-space-agent-skill-variable-"));
  try {
    await mkdir(join(root, "agent", "skills", "review"), { recursive: true });
    await writeFile(
      join(root, "package.json"),
      `${JSON.stringify({ name: "skill-variable-agent", private: true })}\n`
    );
    await writeFile(
      join(root, "agent", "agent.ts"),
      'export default { model: "openai/gpt-5" };\n'
    );
    await writeFile(
      join(root, "agent", "instructions.md"),
      "Before\n{{ available_skills }}\nAfter\n"
    );
    await writeFile(
      join(root, "agent", "skills", "review", "SKILL.md"),
      "---\ndescription: Review code carefully\n---\nFollow the checklist.\n"
    );
    await writeFile(
      join(root, "agent", "skills", "summary.md"),
      "---\ndescription: Summarize findings\n---\nWrite a concise summary.\n"
    );
    await writeFile(
      join(root, "agent", "skills", "formatter.ts"),
      `export default {
        description: "Format the result",
        markdown: "Apply the formatter.",
      };\n`
    );

    const prepared = await resolveAgentGeneration(
      await loadAgent({ startPath: root })
    );
    const resolved = await resolveAgentOperation(prepared, {
      sessionId: "session-skill-variable",
      operationId: "operation-skill-variable",
      messages: [],
    });

    expect(resolved.instructions[0]).toContain("Before\nAvailable skills\n");
    expect(resolved.instructions[0]).toContain(
      "call load_skill before proceeding"
    );
    expect(resolved.instructions[0]).toContain(
      "- review: Review code carefully (path: skills/review/SKILL.md)"
    );
    expect(resolved.instructions[0]).toContain(
      "- summary: Summarize findings (path: skills/summary.md)"
    );
    expect(resolved.instructions[0]).toContain(
      "- formatter: Format the result (path: skills/formatter.ts)"
    );
    expect(resolved.instructions[0]).toEndWith("\nAfter");

    const mounted = mountAgentFrameworkTools(prepared);
    const loadSkill = mounted.tools.get("load_skill")?.model;
    expect(loadSkill?.name).toBe("load_skill");
    expect(loadSkill?.description).toContain("full instructions");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("does not resolve a custom Skills variable unless instructions reference it", async () => {
  const root = await mkdtemp(join(tmpdir(), "llm-space-agent-unused-variable-"));
  try {
    await mkdir(join(root, "agent", "skills", "review"), { recursive: true });
    await writeFile(
      join(root, "package.json"),
      `${JSON.stringify({ name: "unused-variable-agent", private: true })}\n`
    );
    await writeFile(
      join(root, "agent", "agent.ts"),
      'export default { model: "openai/gpt-5" };\n'
    );
    await writeFile(join(root, "agent", "instructions.md"), "No catalog here.\n");
    await writeFile(
      join(root, "agent", "skills", "index.ts"),
      `export default {
        name: "skill_catalog",
        resolve: () => { throw new Error("must not run"); },
      };\n`
    );
    await writeFile(
      join(root, "agent", "skills", "review", "SKILL.md"),
      "---\ndescription: Review code carefully\n---\nFollow the checklist.\n"
    );

    const prepared = await resolveAgentGeneration(
      await loadAgent({ startPath: root })
    );
    const resolved = await resolveAgentOperation(prepared, {
      sessionId: "session-unused-variable",
      operationId: "operation-unused-variable",
      messages: [],
    });

    expect(resolved.instructions).toEqual(["No catalog here."]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects an authored load_skill tool when Skills require the framework loader", async () => {
  const root = await mkdtemp(join(tmpdir(), "llm-space-agent-load-skill-conflict-"));
  try {
    await mkdir(join(root, "agent", "skills", "review"), { recursive: true });
    await mkdir(join(root, "agent", "tools"), { recursive: true });
    await writeFile(
      join(root, "package.json"),
      `${JSON.stringify({ name: "load-skill-conflict-agent", private: true })}\n`
    );
    await writeFile(
      join(root, "agent", "agent.ts"),
      'export default { model: "openai/gpt-5" };\n'
    );
    await writeFile(join(root, "agent", "instructions.md"), "Use Skills.\n");
    await writeFile(
      join(root, "agent", "tools", "load_skill.ts"),
      `export default {
        description: "Authored collision",
        inputSchema: { type: "object" },
        execute: () => "wrong",
      };\n`
    );
    await writeFile(
      join(root, "agent", "skills", "review", "SKILL.md"),
      "---\ndescription: Review code carefully\n---\nFollow the checklist.\n"
    );

    const prepared = await resolveAgentGeneration(
      await loadAgent({ startPath: root })
    );
    expect(() => mountAgentFrameworkTools(prepared)).toThrow(
      'reserves framework tool "load_skill"'
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("skills/index.ts replaces the default Skills variable", async () => {
  const root = await mkdtemp(join(tmpdir(), "llm-space-agent-custom-variable-"));
  try {
    await mkdir(join(root, "agent", "skills", "review"), { recursive: true });
    await writeFile(
      join(root, "package.json"),
      `${JSON.stringify({ name: "custom-variable-agent", private: true })}\n`
    );
    await writeFile(
      join(root, "agent", "agent.ts"),
      'export default { model: "openai/gpt-5" };\n'
    );
    await writeFile(
      join(root, "agent", "instructions.md"),
      "{{skill_catalog}}\n{{available_skills}}\n"
    );
    await writeFile(
      join(root, "agent", "skills", "index.ts"),
      `export default {
        name: "skill_catalog",
        resolve: ({ skills }) => skills.map((skill) => skill.name.toUpperCase()).join(" | "),
      };\n`
    );
    await writeFile(
      join(root, "agent", "skills", "review", "SKILL.md"),
      "---\ndescription: Review code carefully\n---\nFollow the checklist.\n"
    );

    const prepared = await resolveAgentGeneration(
      await loadAgent({ startPath: root })
    );
    const resolved = await resolveAgentOperation(prepared, {
      sessionId: "session-custom-variable",
      operationId: "operation-custom-variable",
      messages: [],
    });

    expect(resolved.instructions).toEqual([
      "REVIEW\n{{available_skills}}",
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
