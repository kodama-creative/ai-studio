import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";

import { loadAgentProject } from "./load-agent-project";

const ROOTS: string[] = [];

afterEach(async () => {
  await Promise.all(
    ROOTS.splice(0).map(async root => rm(root, { recursive: true }))
  );
});

describe("loadAgentProject", () => {
  test("loads and normalizes the required Agent definition", async () => {
    const root = await _fixture();
    await writeFile(join(root, "instructions.md"), "You are helpful.\n");
    await writeFile(
      join(root, "agent.ts"),
      `export default {
        model: "fake/models/codex",
        reasoning: "none",
        environment: {
          LOG_LEVEL: {
            kind: "config",
            required: false,
            description: "Optional runtime logging level"
          },
          PROVIDER_API_KEY: { kind: "secret", required: true }
        }
      };`
    );

    const snapshot = await loadAgentProject(root);

    expect(snapshot.definition).toEqual({
      model: { provider: "fake", id: "models/codex" },
      reasoning: "off",
      environment: {
        LOG_LEVEL: {
          kind: "config",
          required: false,
          description: "Optional runtime logging level"
        },
        PROVIDER_API_KEY: { kind: "secret", required: true }
      }
    });
    expect(snapshot.diagnostics).toEqual([]);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.definition?.model)).toBe(true);
    expect(Object.isFrozen(snapshot.definition?.environment)).toBe(true);
    expect(Object.isFrozen(snapshot.definition?.environment?.PROVIDER_API_KEY))
      .toBe(true);
    expect(Object.isFrozen(snapshot.artifact.fingerprints)).toBe(true);
    expect(snapshot.fingerprint).toBe(snapshot.artifact.fingerprint);
    expect(
      snapshot.artifact.fingerprints.environmentRequirements.entries.map(
        entry => entry.id
      )
    ).toEqual([
      "agent-env:LOG_LEVEL",
      "agent-env:PROVIDER_API_KEY",
      "bun@>=1.3.14"
    ]);
  });

  test("rejects invalid Agent environment requirement declarations", async () => {
    const root = await _fixture();
    await writeFile(join(root, "instructions.md"), "Test.\n");
    await writeFile(
      join(root, "agent.ts"),
      `export default {
        model: "fake/model",
        environment: {
          "invalid-name": { kind: "secret", required: true },
          API_KEY: { kind: "secret", required: true, default: "value" }
        }
      };`
    );

    const snapshot = await loadAgentProject(root);

    expect(snapshot.definition).toBeUndefined();
    expect(snapshot.diagnostics).toEqual([
      expect.objectContaining({ code: "definition_export_invalid" })
    ]);
  });

  test("discovers instructions, executable tools, and skills", async () => {
    const root = await _fixture();
    await writeFile(join(root, "instructions.md"), "You are helpful.\n");
    await mkdir(join(root, "tools"));
    await writeFile(
      join(root, "tools", "weather.ts"),
      `import { defineTool } from "@llm-space/runtime/tools";
      import { Type } from "typebox";
      export default defineTool({
        description: "Returns demo weather.",
        inputSchema: Type.Object({}),
        async execute() { return { weather: "Sunny" }; }
      });`
    );
    await mkdir(join(root, "skills", "forecast"), { recursive: true });
    await writeFile(
      join(root, "skills", "forecast", "SKILL.md"),
      "---\nname: forecast\ndescription: Forecast a trip.\n---\n\nCheck the weather tool.\n"
    );

    const snapshot = await loadAgentProject(root);

    expect(snapshot.instructions).toBe("You are helpful.\n");
    expect(snapshot.tools.map(tool => tool.name)).toEqual(["weather"]);
    expect(snapshot.resources.skills?.map(skill => skill.name)).toEqual([
      "forecast"
    ]);
    expect(snapshot.diagnostics).toEqual([]);
    expect(snapshot.fingerprint).toHaveLength(64);
  });

  test("compiles source-owned MCP connections without resolving callbacks", async () => {
    const root = await _fixture();
    await writeFile(join(root, "instructions.md"), "You are helpful.\n");
    await mkdir(join(root, "connections"));
    await writeFile(
      join(root, "connections", "project.ts"),
      `import { defineMcpClientConnection } from "@llm-space/runtime/connections";
      export default defineMcpClientConnection({
        url: "https://example.com/mcp",
        description: "Project data.",
        auth() { globalThis.__MCP_AUTH_CALLED__ = true; return { token: "secret" }; },
        tools: { allow: ["search"] }
      });`
    );

    const snapshot = await loadAgentProject(root);

    expect(
      (globalThis as Record<string, unknown>).__MCP_AUTH_CALLED__
    ).toBeUndefined();
    expect(snapshot.connections.map(connection => ({
      name: connection.name,
      transport: connection.definition.transport,
      allow: connection.definition.tools.allow
    }))).toEqual([
      { name: "project", transport: "streamableHttp", allow: ["search"] }
    ]);
    expect(snapshot.diagnostics).toEqual([]);
  });

  test("preserves code-point tool ordering for runtime and fingerprint input", async () => {
    const root = await _fixture();
    await writeFile(join(root, "instructions.md"), "You are helpful.\n");
    await mkdir(join(root, "tools"));
    const tool = (value: string) => `import { defineTool } from "@llm-space/runtime/tools";
      import { Type } from "typebox";
      export default defineTool({
      description: "Ordered tool.",
      inputSchema: Type.Object({}),
      async execute() { return "${value}"; }
    });`;
    await writeFile(join(root, "tools", "Z.ts"), tool("upper"));
    await writeFile(join(root, "tools", "a.ts"), tool("lower"));

    const snapshot = await loadAgentProject(root);

    expect(snapshot.tools.map(item => item.name)).toEqual(["Z", "a"]);
  });

  test("returns blocking diagnostics for missing instructions and duplicate tools", async () => {
    const root = await _fixture();
    await mkdir(join(root, "tools"));
    const tool = `import { defineTool } from "@llm-space/runtime/tools";
      import { Type } from "typebox";
      export default defineTool({
      description: "Duplicate.",
      inputSchema: Type.Object({}),
      async execute() { return "ok"; }
    });`;
    await writeFile(join(root, "tools", "a.ts"), tool);
    await writeFile(join(root, "tools", "a.js"), tool);

    const snapshot = await loadAgentProject(root);

    expect(snapshot.diagnostics.map(item => item.code)).toEqual([
      "instructions_missing",
      "tool_name_duplicate"
    ]);
  });

  test("rejects authored tool identity with a migration diagnostic", async () => {
    const root = await _fixture();
    await writeFile(join(root, "instructions.md"), "Test.\n");
    await mkdir(join(root, "tools"));
    await writeFile(
      join(root, "tools", "weather.js"),
      `import { defineTool } from "@llm-space/runtime/tools";
      import { Type } from "typebox";
      export default defineTool({
        name: "legacy_weather",
        label: "Legacy weather",
        description: "Legacy identity.",
        inputSchema: Type.Object({}),
        execute() { return "sunny"; }
      });`
    );

    const snapshot = await loadAgentProject(root);

    expect(snapshot.tools).toEqual([]);
    expect(snapshot.diagnostics).toEqual([
      expect.objectContaining({
        code: "tool_export_invalid",
        message: expect.stringContaining(
          "Remove authored name/label fields; tool identity comes from the filename"
        )
      })
    ]);
  });

  test("rejects qualified MCP names that collide with another project action", async () => {
    const root = await _fixture();
    await writeFile(join(root, "instructions.md"), "Test.\n");
    await mkdir(join(root, "tools"));
    await mkdir(join(root, "connections"));
    await writeFile(
      join(root, "tools", "weather__forecast.ts"),
      `import { defineTool } from "@llm-space/runtime/tools";
      import { Type } from "typebox";
      export default defineTool({
        description: "Local forecast.",
        inputSchema: Type.Object({}),
        execute() { return "local"; }
      });`
    );
    await writeFile(
      join(root, "connections", "weather.ts"),
      `import { defineMcpClientConnection } from "@llm-space/runtime/connections";
      export default defineMcpClientConnection({
        url: "https://example.com/mcp",
        description: "Remote weather.",
        tools: { allow: ["forecast", "forecast"] }
      });`
    );

    const snapshot = await loadAgentProject(root);

    expect(snapshot.connections).toEqual([]);
    expect(snapshot.diagnostics).toEqual([
      expect.objectContaining({
        code: "tool_name_duplicate",
        message: expect.stringContaining("weather__forecast")
      })
    ]);
  });

  test("returns a blocking diagnostic for duplicate connection source names", async () => {
    const root = await _fixture();
    await writeFile(join(root, "instructions.md"), "Test.\n");
    await mkdir(join(root, "connections"));
    const connection = (toolName: string) =>
      `import { defineMcpClientConnection } from "@llm-space/runtime/connections";
      export default defineMcpClientConnection({
        url: "https://example.com/mcp",
        description: "Remote project data.",
        tools: { allow: ["${toolName}"] }
      });`;
    await writeFile(
      join(root, "connections", "project.ts"),
      connection("search")
    );
    await writeFile(
      join(root, "connections", "project.js"),
      connection("lookup")
    );

    const snapshot = await loadAgentProject(root);

    expect(snapshot.diagnostics).toEqual([
      expect.objectContaining({
        severity: "error",
        code: "connection_name_duplicate",
        message: expect.stringContaining('Connection name "project"')
      })
    ]);
  });

  test("returns a blocking diagnostic when the required definition is missing", async () => {
    const root = await _fixture();
    await rm(join(root, "agent.ts"));
    await writeFile(join(root, "instructions.md"), "Test.\n");

    const snapshot = await loadAgentProject(root);

    expect(snapshot.definition).toBeUndefined();
    expect(snapshot.diagnostics).toHaveLength(1);
    expect(snapshot.diagnostics[0]).toMatchObject({
      severity: "error",
      code: "definition_missing"
    });
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
      code: "skill_invalid"
    });
  });

  test("rejects symbolic links at every agent source slot", async () => {
    const root = await _fixture();
    await rm(join(root, "agent.ts"));
    await writeFile(
      join(root, "real-agent.ts"),
      `export default { model: "fake/fake-model" };`
    );
    await writeFile(join(root, "real-instructions.md"), "Outside source.\n");
    await mkdir(join(root, "real-tools"));
    await mkdir(join(root, "real-skills"));
    await symlink(join(root, "real-agent.ts"), join(root, "agent.ts"));
    await symlink(
      join(root, "real-instructions.md"),
      join(root, "instructions.md")
    );
    await symlink(join(root, "real-tools"), join(root, "tools"));
    await symlink(join(root, "real-skills"), join(root, "skills"));

    const snapshot = await loadAgentProject(root);

    expect(snapshot.diagnostics.map(item => item.code)).toEqual([
      "definition_import_failed",
      "instructions_read_failed",
      "tool_import_failed",
      "skill_invalid"
    ]);
  });

  test("reloads changed tool modules by source fingerprint", async () => {
    const root = await _fixture();
    await writeFile(join(root, "instructions.md"), "Test.\n");
    await mkdir(join(root, "tools"));
    const toolPath = join(root, "tools", "value.ts");
    const source = (value: string) => `import { defineTool } from "@llm-space/runtime/tools";
      import { Type } from "typebox";
      export default defineTool({
      description: "Return value.",
      inputSchema: Type.Object({}),
      async execute() { return "${value}"; }
    });`;
    await writeFile(toolPath, source("one"));
    const first = await loadAgentProject(root);
    await writeFile(toolPath, source("two"));
    const second = await loadAgentProject(root);

    expect(second.fingerprint).not.toBe(first.fingerprint);
    expect((await second.tools[0]!.execute("call", {})).content[0]).toEqual({
      type: "text",
      text: "two"
    });
  });

  test("builds inspectable deterministic artifacts across absolute roots", async () => {
    const roots = [await _fixture(), await _fixture()];
    for (const root of roots) {
      await writeFile(join(root, "instructions.md"), "Artifact fixture.\n");
      await writeFile(join(root, "value-helper.ts"), "export const value = 'stable';\n");
      await mkdir(join(root, "tools"));
      await writeFile(
        join(root, "tools", "value.ts"),
        `import { defineTool } from "@llm-space/runtime/tools";
        import { Type } from "typebox";
        import { value } from "../value-helper";
        export default defineTool({
          description: "Return a stable value.",
          inputSchema: Type.Object({ key: Type.String() }),
          outputSchema: Type.Object({ value: Type.String() }),
          execute() { return { value }; }
        });`
      );
      await mkdir(join(root, "connections"));
      await writeFile(
        join(root, "connections", "fixture.ts"),
        `import { defineMcpClientConnection } from "@llm-space/runtime/connections";
        export default defineMcpClientConnection({
          url: "https://artifact.invalid/mcp",
          description: "Artifact fixture.",
          auth() { return { token: "artifact-secret" }; },
          tools: { allow: ["lookup"] }
        });`
      );
      await mkdir(join(root, "skills", "artifact"), { recursive: true });
      await writeFile(
        join(root, "skills", "artifact", "SKILL.md"),
        "---\nname: artifact\ndescription: Inspect an artifact.\n---\n\nInspect it.\n"
      );
    }

    const first = await loadAgentProject(roots[0]!);
    const repeated = await loadAgentProject(roots[0]!);
    const copied = await loadAgentProject(roots[1]!);

    expect(first.diagnostics).toEqual([]);
    expect(first.artifact).toEqual(repeated.artifact);
    expect(first.artifact).toEqual(copied.artifact);
    expect(Object.keys(first.artifact.fingerprints)).toEqual([
      "sources",
      "dependencies",
      "capabilities",
      "schemas",
      "runtime",
      "environmentRequirements"
    ]);
    for (const section of [
      first.artifact.fingerprints.sources,
      first.artifact.fingerprints.dependencies,
      first.artifact.fingerprints.capabilities,
      first.artifact.fingerprints.schemas,
      first.artifact.fingerprints.runtime,
      first.artifact.fingerprints.environmentRequirements
    ]) {
      expect(section.fingerprint).toHaveLength(64);
    }
    expect(first.artifact.fingerprints.sources.entries.map(entry => entry.id))
      .toEqual([
        "agent.ts",
        "connections/fixture.ts",
        "instructions.md",
        "skills/artifact/SKILL.md",
        "tools/value.ts"
      ]);
    expect(
      first.artifact.fingerprints.dependencies.entries.map(entry => entry.id)
    ).toEqual(["tools/value.ts -> project:value-helper.ts"]);
    expect(first.artifact.fingerprints.schemas.entries.map(entry => entry.id))
      .toEqual(["tool:value:input", "tool:value:output"]);
    expect(first.artifact.fingerprints.environmentRequirements.entries)
      .toEqual([expect.objectContaining({ id: "bun@>=1.3.14" })]);
    expect(first.artifact.fingerprints.runtime.entries.map(entry => entry.id))
      .toEqual(expect.arrayContaining([
        "@earendil-works/pi-agent-core@0.80.3",
        "@earendil-works/pi-ai@0.80.3",
        "@modelcontextprotocol/sdk@1.29.0",
        "runtime-source:node/compiler/create-agent-project-artifact.ts"
      ]));
    expect(Object.isFrozen(first.artifact)).toBe(true);
    expect(Object.isFrozen(first.artifact.fingerprints.sources.entries))
      .toBe(true);
    expect(JSON.stringify(first.artifact)).not.toContain("artifact-secret");
    expect(JSON.stringify(first.artifact)).not.toContain("artifact.invalid");
  });

  test("fingerprints the same source bytes that the bundler imports", async () => {
    const root = await _fixture();
    await writeFile(join(root, "instructions.md"), "Test.\n");
    await mkdir(join(root, "tools"));
    const toolPath = join(root, "tools", "self-edit.ts");
    const source = `import { writeFileSync } from "node:fs";
      import { defineTool } from "@llm-space/runtime/tools";
      import { Type } from "typebox";
      writeFileSync(${JSON.stringify(toolPath)}, "changed after bundle");
      export default defineTool({
        description: "Mutates its source after Bun captured it.",
        inputSchema: Type.Object({}),
        execute() { return "compiled"; }
      });`;
    await writeFile(toolPath, source);

    const first = await loadAgentProject(root);
    expect(await readFile(toolPath, "utf8")).toBe("changed after bundle");
    await writeFile(toolPath, source);
    const rebuilt = await loadAgentProject(root);

    expect(first.diagnostics).toEqual([]);
    expect(first.artifact).toEqual(rebuilt.artifact);
    expect((await first.tools[0]!.execute("call", {})).content[0]).toEqual({
      type: "text",
      text: "compiled"
    });
  });

  test("reloads tool modules when a bundled dependency changes", async () => {
    const root = await _fixture();
    await writeFile(join(root, "instructions.md"), "Test.\n");
    await mkdir(join(root, "tools"));
    await writeFile(
      join(root, "tools", "value.ts"),
      `import { defineTool } from "@llm-space/runtime/tools";
      import { Type } from "typebox";
      import { value } from "../value-helper";
      export default defineTool({
        description: "Return imported value.",
        inputSchema: Type.Object({}),
        execute() { return value; }
      });`
    );
    const helperPath = join(root, "value-helper.ts");
    await writeFile(helperPath, `export const value = "one";`);
    const first = await loadAgentProject(root);
    await writeFile(helperPath, `export const value = "two";`);
    const second = await loadAgentProject(root);

    expect(second.fingerprint).not.toBe(first.fingerprint);
    expect(second.artifact.fingerprints.sources.fingerprint)
      .toBe(first.artifact.fingerprints.sources.fingerprint);
    expect(second.artifact.fingerprints.dependencies.fingerprint)
      .not.toBe(first.artifact.fingerprints.dependencies.fingerprint);
    expect(second.artifact.fingerprints.capabilities.fingerprint)
      .toBe(first.artifact.fingerprints.capabilities.fingerprint);
    expect(second.artifact.fingerprints.schemas.fingerprint)
      .toBe(first.artifact.fingerprints.schemas.fingerprint);
    expect(second.artifact.fingerprints.runtime.fingerprint)
      .toBe(first.artifact.fingerprints.runtime.fingerprint);
    expect(second.artifact.fingerprints.environmentRequirements.fingerprint)
      .toBe(first.artifact.fingerprints.environmentRequirements.fingerprint);
    expect((await second.tools[0]!.execute("call", {})).content[0]).toEqual({
      type: "text",
      text: "two"
    });
  });

  test("separates compiled capability and schema fingerprints", async () => {
    const root = await _fixture();
    await writeFile(join(root, "instructions.md"), "Test.\n");
    await mkdir(join(root, "tools"));
    const toolPath = join(root, "tools", "value.ts");
    const tool = (description: string, schemaType: "number" | "string") =>
      `import { defineTool } from "@llm-space/runtime/tools";
      import { Type } from "typebox";
      export default defineTool({
        description: "${description}",
        inputSchema: Type.Object({ value: Type.${schemaType === "string" ? "String" : "Number"}() }),
        execute({ value }) { return value; }
      });`;
    await writeFile(toolPath, tool("First capability.", "string"));
    const first = await loadAgentProject(root);
    await writeFile(toolPath, tool("Second capability.", "string"));
    const capabilityChanged = await loadAgentProject(root);
    await writeFile(toolPath, tool("Second capability.", "number"));
    const schemaChanged = await loadAgentProject(root);

    expect(capabilityChanged.artifact.fingerprints.sources.fingerprint)
      .not.toBe(first.artifact.fingerprints.sources.fingerprint);
    expect(capabilityChanged.artifact.fingerprints.capabilities.fingerprint)
      .not.toBe(first.artifact.fingerprints.capabilities.fingerprint);
    expect(capabilityChanged.artifact.fingerprints.schemas.fingerprint)
      .toBe(first.artifact.fingerprints.schemas.fingerprint);
    expect(schemaChanged.artifact.fingerprints.capabilities.fingerprint)
      .toBe(capabilityChanged.artifact.fingerprints.capabilities.fingerprint);
    expect(schemaChanged.artifact.fingerprints.schemas.fingerprint)
      .not.toBe(capabilityChanged.artifact.fingerprints.schemas.fingerprint);
  });

  test("reloads changed Agent definitions in the same process", async () => {
    const root = await _fixture();
    await writeFile(join(root, "instructions.md"), "Test.\n");
    const definitionPath = join(root, "agent.ts");
    await writeFile(
      definitionPath,
      `export default { model: "fake/model-one", reasoning: "provider-default" };`
    );
    const first = await loadAgentProject(root);
    await writeFile(
      definitionPath,
      `export default { model: "fake/model-two", reasoning: "xhigh" };`
    );
    const second = await loadAgentProject(root);

    expect(first.definition).toEqual({
      model: { provider: "fake", id: "model-one" }
    });
    expect(second.definition).toEqual({
      model: { provider: "fake", id: "model-two" },
      reasoning: "xhigh"
    });
    expect(second.fingerprint).not.toBe(first.fingerprint);
  });
});

async function _fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "llm-space-runtime-"));
  ROOTS.push(root);
  await writeFile(
    join(root, "agent.ts"),
    `export default { model: "fake/fake-model" };`
  );
  return root;
}
