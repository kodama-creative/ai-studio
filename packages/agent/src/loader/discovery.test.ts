import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { discoverAgent, resolveAgentProject } from "./index";

const ROOTS: string[] = [];

async function _fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "llm-space-agent-discovery-"));
  ROOTS.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    ROOTS.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

describe("agent discovery", () => {
  test("resolves the nearest nested project from a child file", async () => {
    const root = await _fixture();
    await mkdir(join(root, "agent", "tools"), { recursive: true });
    await writeFile(join(root, "package.json"), '{"name":"weather-agent"}');
    await writeFile(join(root, "agent", "instructions.md"), "Be useful.");
    const toolPath = join(root, "agent", "tools", "get_weather.ts");
    await writeFile(toolPath, "export default {};");

    const project = await resolveAgentProject({ startPath: toolPath });
    expect(project).toEqual({
      agentRoot: join(root, "agent"),
      appRoot: root,
      layout: "nested",
    });
  });

  test("discovers path-derived slots and deterministic subagents", async () => {
    const root = await _fixture();
    const agentRoot = join(root, "agent");
    await mkdir(join(agentRoot, "tools", "billing"), { recursive: true });
    await mkdir(join(agentRoot, "skills", "review"), { recursive: true });
    await mkdir(join(agentRoot, "hooks"), { recursive: true });
    await mkdir(join(agentRoot, "subagents", "researcher", "tools"), {
      recursive: true,
    });
    await writeFile(join(root, "package.json"), '{"name":"@acme/support"}');
    await writeFile(join(agentRoot, "agent.ts"), "export default {};");
    await writeFile(join(agentRoot, "instructions.md"), "Support users.");
    await writeFile(
      join(agentRoot, "tools", "billing", "refund.ts"),
      "export default {};"
    );
    await writeFile(join(agentRoot, "hooks", "audit.ts"), "export default {};");
    await writeFile(
      join(agentRoot, "skills", "review", "SKILL.md"),
      "---\nname: review\ndescription: Review work\n---\nReview carefully."
    );
    const subagentRoot = join(agentRoot, "subagents", "researcher");
    await writeFile(join(subagentRoot, "agent.ts"), "export default {};");
    await writeFile(
      join(subagentRoot, "tools", "search.ts"),
      "export default {};"
    );

    const result = await discoverAgent({ startPath: root });

    expect(result.diagnostics).toEqual([]);
    expect(result.manifest.agentId).toBe("@acme/support");
    expect(result.manifest.tools).toEqual([
      expect.objectContaining({
        logicalPath: "tools/billing/refund.ts",
        name: "billing-refund",
      }),
    ]);
    expect(result.manifest.skills).toEqual([
      expect.objectContaining({
        logicalPath: "skills/review/SKILL.md",
        name: "review",
      }),
    ]);
    expect(result.manifest.hooks[0]?.logicalPath).toBe("hooks/audit.ts");
    expect(result.manifest.hooks[0]?.name).toBe("audit");
    expect(result.manifest.subagents[0]?.agentId).toBe("researcher");
    expect(result.manifest.subagents[0]?.agent?.logicalPath).toBe("agent.ts");
  });

  test("reserves skills/index.ts for the Skills collection variable", async () => {
    const root = await _fixture();
    const agentRoot = join(root, "agent");
    await mkdir(join(agentRoot, "skills", "review"), { recursive: true });
    await writeFile(join(root, "package.json"), '{"name":"skills-variable"}');
    await writeFile(join(agentRoot, "instructions.md"), "{{available_skills}}");
    await writeFile(
      join(agentRoot, "skills", "index.ts"),
      "export default { name: 'skill_catalog', resolve() { return 'catalog'; } };"
    );
    await writeFile(
      join(agentRoot, "skills", "review", "SKILL.md"),
      "---\ndescription: Review work\n---\nReview carefully."
    );

    const result = await discoverAgent({ startPath: root });

    expect(result.manifest.skillsVariable).toMatchObject({
      logicalPath: "skills/index.ts",
      moduleId: "skills/index.ts",
      sourceKind: "module",
    });
    expect(result.manifest.skills).toEqual([
      expect.objectContaining({ name: "review" }),
    ]);
  });

  test("returns stable diagnostics for missing instructions and invalid tools", async () => {
    const root = await _fixture();
    await mkdir(join(root, "tools"), { recursive: true });
    await writeFile(join(root, "agent.ts"), "export default {};");
    await writeFile(join(root, "tools", "9bad.ts"), "export default {};");

    const result = await discoverAgent({ startPath: root });

    expect(result.project.layout).toBe("flat");
    expect(result.diagnostics.map((item) => item.code)).toEqual([
      "discover/required-instructions-missing",
      "discover/tool-name-invalid",
    ]);
  });

  test("discovers recursive markdown schedules with path-derived names", async () => {
    const root = await _fixture();
    await mkdir(join(root, "agent", "schedules", "billing"), {
      recursive: true,
    });
    await writeFile(join(root, "package.json"), '{"name":"scheduled-agent"}');
    await writeFile(join(root, "agent", "instructions.md"), "Be useful.");
    await writeFile(
      join(root, "agent", "schedules", "billing", "invoice-sweep.md"),
      "---\ncron: 0 9 * * *\n---\nSweep invoices."
    );

    const result = await discoverAgent({ startPath: root });

    expect(result.manifest.schedules).toEqual([
      expect.objectContaining({
        logicalPath: "schedules/billing/invoice-sweep.md",
        name: "billing/invoice-sweep",
        sourceKind: "markdown",
      }),
    ]);
  });

  test("discovers flat subagent modules and directory extension mounts", async () => {
    const root = await _fixture();
    const agentRoot = join(root, "agent");
    await mkdir(join(agentRoot, "subagents"), { recursive: true });
    await mkdir(join(agentRoot, "extensions", "crm", "tools"), {
      recursive: true,
    });
    await mkdir(join(agentRoot, "extensions", "crm", "schedules"), {
      recursive: true,
    });
    await writeFile(join(root, "package.json"), '{"name":"layout-agent"}');
    await writeFile(
      join(agentRoot, "agent.ts"),
      'export default { model: "test/model" };'
    );
    await writeFile(join(agentRoot, "instructions.md"), "Be useful.");
    await writeFile(
      join(agentRoot, "subagents", "weather.ts"),
      "export default {};"
    );
    await writeFile(
      join(agentRoot, "extensions", "crm", "extension.ts"),
      "export default {};"
    );
    await writeFile(
      join(agentRoot, "extensions", "crm", "tools", "search.ts"),
      "export default {};"
    );
    await writeFile(
      join(agentRoot, "extensions", "crm", "schedules", "sync.ts"),
      "export default {};"
    );

    const result = await discoverAgent({ startPath: root });

    expect(result.manifest.subagents).toHaveLength(1);
    expect(result.manifest.subagents[0]?.agentId).toBe("weather");
    expect(result.manifest.subagents[0]?.agent?.logicalPath).toBe(
      "subagents/weather.ts"
    );
    expect(result.manifest.extensions).toHaveLength(1);
    expect(result.manifest.extensions[0]?.logicalPath).toBe(
      "extensions/crm/extension.ts"
    );
    expect(result.manifest.extensions[0]?.name).toBe("crm");
    expect(result.manifest.extensions[0]?.overrides?.tools[0]).toMatchObject({
      logicalPath: "tools/search.ts",
      name: "search",
    });
    expect(result.diagnostics.map((item) => item.code)).toContain(
      "discover/extension-slot-unsupported"
    );
  });
});
