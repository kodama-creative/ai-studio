import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "bun:test";

import { discoverAgentProject } from "./discover-agent-project";

const ROOTS: string[] = [];

afterEach(async () => {
  delete (globalThis as Record<string, unknown>)
    .__LLM_SPACE_DISCOVERY_EXECUTED__;
  await Promise.all(
    ROOTS.splice(0).map(async root => rm(root, { recursive: true, force: true }))
  );
});

describe("discoverAgentProject", () => {
  test("discovers authored sources without executing their modules", async () => {
    const root = _root();
    await mkdir(path.join(root, "tools"), { recursive: true });
    await mkdir(path.join(root, "connections"), { recursive: true });
    await writeFile(
      path.join(root, "agent.ts"),
      "globalThis.__LLM_SPACE_DISCOVERY_EXECUTED__ = true; export default {};\n"
    );
    await writeFile(path.join(root, "instructions.md"), "Be concise.\n");
    await writeFile(
      path.join(root, "tools", "danger.ts"),
      "globalThis.__LLM_SPACE_DISCOVERY_EXECUTED__ = true; export default {};\n"
    );
    await writeFile(
      path.join(root, "connections", "project.ts"),
      "globalThis.__LLM_SPACE_DISCOVERY_EXECUTED__ = true; export default {};\n"
    );

    const discovered = await discoverAgentProject(root);

    expect(
      (globalThis as Record<string, unknown>).__LLM_SPACE_DISCOVERY_EXECUTED__
    ).toBeUndefined();
    expect(discovered.root).toBe(root);
    expect(discovered.definition?.logicalPath).toBe("agent.ts");
    expect(discovered.instructions?.logicalPath).toBe("instructions.md");
    expect(discovered.skillsRoot).toBe(path.join(root, "skills"));
    expect(discovered.tools.map(tool => tool.logicalPath)).toEqual([
      "tools/danger.ts"
    ]);
    expect(discovered.connections.map(connection => connection.logicalPath))
      .toEqual(["connections/project.ts"]);
    expect(discovered.diagnostics).toEqual([]);
  });

  test("reports missing and invalid source slots as diagnostics", async () => {
    const root = _root();
    await mkdir(path.join(root, "tools", "not-a-file.ts"), {
      recursive: true
    });

    const discovered = await discoverAgentProject(root);

    expect(discovered.diagnostics.map(diagnostic => diagnostic.code)).toEqual(
      ["definition_missing", "instructions_missing", "tool_import_failed"]
    );
    expect(discovered.tools).toEqual([]);
    expect(discovered.skillsRoot).toBe(path.join(root, "skills"));
  });

  test("keeps symlinked source slots outside the discovered project", async () => {
    const root = _root();
    const outside = `${root}-outside`;
    ROOTS.push(outside);
    await mkdir(root, { recursive: true });
    await mkdir(outside, { recursive: true });
    await writeFile(path.join(root, "agent.ts"), "export default {};\n");
    await writeFile(path.join(root, "instructions.md"), "Be concise.\n");
    await symlink(outside, path.join(root, "tools"));
    await symlink(outside, path.join(root, "skills"));

    const discovered = await discoverAgentProject(root);

    expect(discovered.tools).toEqual([]);
    expect(discovered.skillsRoot).toBeUndefined();
    expect(discovered.diagnostics).toEqual([
      {
        severity: "error",
        code: "tool_import_failed",
        message: "The tools source directory cannot be a symbolic link",
        path: path.join(root, "tools")
      },
      {
        severity: "error",
        code: "skill_invalid",
        message: "The skills source directory cannot be a symbolic link",
        path: path.join(root, "skills")
      }
    ]);
  });
});

function _root(): string {
  const root = path.join(
    tmpdir(),
    `llm-space-runtime-discover-${crypto.randomUUID()}`
  );
  ROOTS.push(root);
  return root;
}
