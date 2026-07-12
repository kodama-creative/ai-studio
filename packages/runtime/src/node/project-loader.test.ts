import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "bun:test";

import { loadAgentProject } from "./project-loader";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true }))
  );
});

describe("loadAgentProject", () => {
  test("discovers instructions, executable tools, and skills", async () => {
    const root = await _fixture();
    await writeFile(join(root, "instructions.md"), "You are helpful.\n");
    await mkdir(join(root, "tools"));
    await writeFile(
      join(root, "tools", "weather.ts"),
      `export default {
        name: "get_weather",
        label: "Get weather",
        description: "Returns demo weather.",
        parameters: { type: "object", properties: {}, additionalProperties: false },
        async execute() { return { content: [{ type: "text", text: "Sunny" }], details: undefined }; }
      };`
    );
    await mkdir(join(root, "skills", "forecast"), { recursive: true });
    await writeFile(
      join(root, "skills", "forecast", "SKILL.md"),
      "---\nname: forecast\ndescription: Forecast a trip.\n---\n\nCheck the weather tool.\n"
    );

    const snapshot = await loadAgentProject(root);

    expect(snapshot.instructions).toBe("You are helpful.\n");
    expect(snapshot.tools.map((tool) => tool.name)).toEqual(["get_weather"]);
    expect(snapshot.resources.skills?.map((skill) => skill.name)).toEqual([
      "forecast",
    ]);
    expect(snapshot.diagnostics).toEqual([]);
    expect(snapshot.fingerprint).toHaveLength(64);
  });

  test("returns blocking diagnostics for missing instructions and duplicate tools", async () => {
    const root = await _fixture();
    await mkdir(join(root, "tools"));
    const tool = `export default {
      name: "same",
      label: "Same",
      description: "Duplicate.",
      parameters: { type: "object", properties: {} },
      async execute() { return { content: [{ type: "text", text: "ok" }], details: undefined }; }
    };`;
    await writeFile(join(root, "tools", "a.ts"), tool);
    await writeFile(join(root, "tools", "b.ts"), tool);

    const snapshot = await loadAgentProject(root);

    expect(snapshot.diagnostics.map((item) => item.code)).toEqual([
      "instructions_missing",
      "tool_name_duplicate",
    ]);
  });

  test("treats invalid skills as blocking project diagnostics", async () => {
    const root = await _fixture();
    await writeFile(join(root, "instructions.md"), "Test.\n");
    await mkdir(join(root, "skills", "broken"), { recursive: true });
    await writeFile(
      join(root, "skills", "broken", "SKILL.md"),
      "---\nname: broken\n---\nMissing description.\n"
    );

    const snapshot = await loadAgentProject(root);

    expect(snapshot.diagnostics).toHaveLength(1);
    expect(snapshot.diagnostics[0]).toMatchObject({
      severity: "error",
      code: "skill_invalid",
    });
  });

  test("rejects symbolic links at every agent source slot", async () => {
    const root = await _fixture();
    await writeFile(join(root, "real-instructions.md"), "Outside source.\n");
    await mkdir(join(root, "real-tools"));
    await mkdir(join(root, "real-skills"));
    await symlink(
      join(root, "real-instructions.md"),
      join(root, "instructions.md")
    );
    await symlink(join(root, "real-tools"), join(root, "tools"));
    await symlink(join(root, "real-skills"), join(root, "skills"));

    const snapshot = await loadAgentProject(root);

    expect(snapshot.diagnostics.map((item) => item.code)).toEqual([
      "instructions_read_failed",
      "tool_import_failed",
      "skill_invalid",
    ]);
  });

  test("reloads changed tool modules by source fingerprint", async () => {
    const root = await _fixture();
    await writeFile(join(root, "instructions.md"), "Test.\n");
    await mkdir(join(root, "tools"));
    const toolPath = join(root, "tools", "value.ts");
    const source = (value: string) => `export default {
      name: "value",
      label: "Value",
      description: "Return value.",
      parameters: { type: "object", properties: {} },
      async execute() { return { content: [{ type: "text", text: "${value}" }], details: undefined }; }
    };`;
    await writeFile(toolPath, source("one"));
    const first = await loadAgentProject(root);
    await writeFile(toolPath, source("two"));
    const second = await loadAgentProject(root);

    expect(second.fingerprint).not.toBe(first.fingerprint);
    expect((await second.tools[0]!.execute("call", {})).content[0]).toEqual({
      type: "text",
      text: "two",
    });
  });
});

async function _fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "llm-space-runtime-"));
  roots.push(root);
  return root;
}
