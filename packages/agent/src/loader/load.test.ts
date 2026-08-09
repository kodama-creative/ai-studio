import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { AgentLoadError, loadAgent } from "./index";

const ROOTS: string[] = [];

async function _fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "llm-space-agent-loader-"));
  ROOTS.push(root);
  await mkdir(join(root, "agent", "tools"), { recursive: true });
  await writeFile(join(root, "package.json"), '{"name":"@acme/echo"}');
  return root;
}

async function _captureLoadError(root: string): Promise<AgentLoadError> {
  try {
    await loadAgent({ startPath: root });
  } catch (error) {
    expect(error).toBeInstanceOf(AgentLoadError);
    return error as AgentLoadError;
  }
  throw new Error("expected loadAgent to reject");
}

afterEach(async () => {
  await Promise.all(
    ROOTS.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

describe("loadAgent", () => {
  test("loads authored values into a serializable manifest and keeps executable modules separate", async () => {
    const root = await _fixture();
    await writeFile(
      join(root, "agent", "agent.ts"),
      'export default async () => ({ model: "openai/gpt-5", outputSchema: { type: "object" } });'
    );
    await writeFile(join(root, "agent", "instructions.md"), "  Be useful.  \n");
    await writeFile(
      join(root, "agent", "tools", "echo.ts"),
      [
        "export default async () => ({",
        '  description: "Echo input",',
        '  inputSchema: { type: "object", properties: { value: { type: "string" } } },',
        "  execute: ({ value }) => value,",
        "});",
      ].join("\n")
    );

    const loaded = await loadAgent({ startPath: root });

    expect(loaded.manifest).toMatchObject({
      kind: "llm-space-agent-manifest",
      agentId: "@acme/echo",
      agent: { model: "openai/gpt-5", outputSchema: { type: "object" } },
      agentSource: { sourceId: "agent.ts", logicalPath: "agent.ts" },
      instructions: [{ markdown: "Be useful.", sourceId: "instructions.md" }],
      tools: [
        {
          description: "Echo input",
          inputSchema: {
            type: "object",
            properties: { value: { type: "string" } },
          },
          name: "echo",
          sourceId: "tools/echo.ts",
        },
      ],
    });
    expect(JSON.parse(JSON.stringify(loaded.manifest))).toEqual(
      loaded.manifest
    );
    expect(
      loaded.moduleMap.nodes.$root.modules["tools/echo.ts"]?.default
    ).toBeFunction();
    expect(loaded.sourceFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(loaded.diagnostics).toEqual([]);
  });

  test("canonicalizes Standard JSON Schema without leaking converter functions", async () => {
    const root = await _fixture();
    const schemaSource = [
      "const schema = {",
      '  "~standard": {',
      "    version: 1,",
      '    vendor: "fixture",',
      "    jsonSchema: {",
      '      input: ({ target }) => ({ $schema: target, type: "string", title: "input" }),',
      '      output: ({ target }) => ({ $schema: target, type: "string", title: "output" }),',
      "    },",
      "  },",
      "};",
    ].join("\n");
    await writeFile(
      join(root, "agent", "agent.ts"),
      `${schemaSource}\nexport default { model: "test/model", outputSchema: schema };`
    );
    await writeFile(join(root, "agent", "instructions.md"), "Be useful.");
    await writeFile(
      join(root, "agent", "tools", "echo.ts"),
      `${schemaSource}\nexport default { description: "Echo", inputSchema: schema, outputSchema: schema, execute() {} };`
    );

    const loaded = await loadAgent({ startPath: root });

    expect(loaded.manifest.agent.outputSchema).toEqual({
      $schema: "draft-2020-12",
      type: "string",
      title: "output",
    });
    expect(loaded.manifest.tools[0]?.inputSchema).toEqual({
      $schema: "draft-2020-12",
      type: "string",
      title: "input",
    });
    expect(loaded.manifest.tools[0]?.outputSchema).toEqual({
      $schema: "draft-2020-12",
      type: "string",
      title: "output",
    });
  });

  test("keeps generic Standard Schema executable while serializing its descriptor", async () => {
    const root = await _fixture();
    const schemaSource = [
      "const schema = {",
      '  "~standard": {',
      "    version: 1,",
      '    vendor: "fixture-validator",',
      "    validate: value => ({ value }),",
      "  },",
      "};",
    ].join("\n");
    await writeFile(
      join(root, "agent", "agent.ts"),
      'export default { model: "test/model" };'
    );
    await writeFile(join(root, "agent", "instructions.md"), "Be useful.");
    await writeFile(
      join(root, "agent", "tools", "validate.ts"),
      `${schemaSource}\nexport default { description: "Validate", inputSchema: schema, execute(value) { return value; } };`
    );

    const loaded = await loadAgent({ startPath: root });

    expect(loaded.manifest.tools[0]?.inputSchema).toEqual({
      "x-llm-space-standard-schema": {
        direction: "input",
        vendor: "fixture-validator",
        version: 1,
      },
    });
    const executable = loaded.moduleMap.nodes.$root.modules["tools/validate.ts"]
      ?.default as { inputSchema?: { "~standard"?: { validate?: unknown } } };
    expect(executable.inputSchema?.["~standard"]?.validate).toBeFunction();
  });

  test("throws AgentLoadError with discovery diagnostics before evaluating modules", async () => {
    const root = await _fixture();
    await writeFile(
      join(root, "agent", "agent.ts"),
      "throw new Error('must not run');"
    );

    try {
      await loadAgent({ startPath: root });
      throw new Error("expected loadAgent to reject");
    } catch (error) {
      expect(error).toBeInstanceOf(AgentLoadError);
      expect(
        (error as AgentLoadError).diagnostics.map((item) => item.code)
      ).toEqual(["discover/required-instructions-missing"]);
    }
  });

  test("wraps authored factory failures with source diagnostics", async () => {
    const root = await _fixture();
    await writeFile(
      join(root, "agent", "agent.ts"),
      'export default { model: "test/model" };'
    );
    await writeFile(join(root, "agent", "instructions.md"), "Be useful.");
    await writeFile(
      join(root, "agent", "tools", "echo.ts"),
      'export default async () => { throw new Error("credential unavailable"); };'
    );

    try {
      await loadAgent({ startPath: root });
      throw new Error("expected loadAgent to reject");
    } catch (error) {
      expect(error).toBeInstanceOf(AgentLoadError);
      const [diagnostic] = (error as AgentLoadError).diagnostics;
      expect(diagnostic?.code).toBe("load/module-factory-failed");
      expect(diagnostic?.message).toContain("credential unavailable");
      expect(diagnostic?.sourcePath).toBe(
        join(root, "agent", "tools", "echo.ts")
      );
    }
  });

  test("loads recursive subagents into path-stable module scopes", async () => {
    const root = await _fixture();
    const researcher = join(root, "agent", "subagents", "researcher");
    const writer = join(researcher, "subagents", "writer");
    await mkdir(join(researcher, "tools"), { recursive: true });
    await mkdir(join(writer, "tools"), { recursive: true });
    await writeFile(
      join(root, "agent", "agent.ts"),
      'export default { model: "test/model" };'
    );
    await writeFile(join(root, "agent", "instructions.md"), "Coordinate.");
    await writeFile(
      join(researcher, "agent.ts"),
      'export default { model: "research", description: "Research" };'
    );
    await writeFile(
      join(researcher, "tools", "search.ts"),
      'export default { description: "Search", inputSchema: {}, execute() {} };'
    );
    await writeFile(
      join(writer, "agent.ts"),
      'export default { model: "writer", description: "Write" };'
    );
    await writeFile(
      join(writer, "tools", "draft.ts"),
      'export default { description: "Draft", inputSchema: {}, execute() {} };'
    );

    const loaded = await loadAgent({ startPath: root });

    expect(loaded.manifest.subagents[0]).toMatchObject({
      agentId: "researcher",
      agent: { model: "research" },
      subagents: [{ agentId: "writer", agent: { model: "writer" } }],
    });
    expect(
      loaded.moduleMap.nodes["subagent:researcher"]?.modules["tools/search.ts"]
    ).toBeDefined();
    expect(
      loaded.moduleMap.nodes["subagent:researcher/writer"]?.modules[
        "tools/draft.ts"
      ]
    ).toBeDefined();
  });

  test("normalizes markdown and module schedules without placing handlers in the manifest", async () => {
    const root = await _fixture();
    await mkdir(join(root, "agent", "schedules", "billing"), {
      recursive: true,
    });
    await writeFile(
      join(root, "agent", "agent.ts"),
      'export default { model: "test/model" };'
    );
    await writeFile(join(root, "agent", "instructions.md"), "Be useful.");
    await writeFile(
      join(root, "agent", "schedules", "billing", "sweep.md"),
      "---\ncron: 0 9 * * *\n---\n  Sweep invoices.  \n"
    );
    await writeFile(
      join(root, "agent", "schedules", "notify.ts"),
      'export default { cron: "0 10 * * *", run() { return "sent"; } };'
    );

    const loaded = await loadAgent({ startPath: root });

    expect(loaded.manifest.schedules).toEqual([
      {
        cron: "0 9 * * *",
        hasRun: false,
        logicalPath: "schedules/billing/sweep.md",
        markdown: "Sweep invoices.",
        name: "billing/sweep",
        sourceId: "schedules/billing/sweep.md",
        sourceKind: "markdown",
      },
      {
        cron: "0 10 * * *",
        hasRun: true,
        logicalPath: "schedules/notify.ts",
        name: "notify",
        sourceId: "schedules/notify.ts",
        sourceKind: "module",
      },
    ]);
    expect(
      loaded.moduleMap.nodes.$root.modules["schedules/notify.ts"]?.default
    ).toBeDefined();
  });

  test("describes every executable harness slot while keeping callbacks in the module map", async () => {
    const root = await _fixture();
    const agentRoot = join(root, "agent");
    await Promise.all(
      [
        "channels",
        "connections",
        "hooks",
        "skills/review",
        "sandbox/workspace",
      ].map((path) => mkdir(join(agentRoot, path), { recursive: true }))
    );
    await writeFile(
      join(agentRoot, "agent.ts"),
      'export default { model: "test/model" };'
    );
    await writeFile(join(agentRoot, "instructions.md"), "Be useful.");
    await writeFile(
      join(agentRoot, "channels", "api.ts"),
      'export default { routes: [{ method: "POST", path: "/run", handler() {} }], metadata: { source: "api" } };'
    );
    await writeFile(
      join(agentRoot, "connections", "search.ts"),
      'export default { protocol: "mcp", description: "Search", url: "https://mcp.example.test", auth: { getToken() {} } };'
    );
    await writeFile(
      join(agentRoot, "hooks", "audit.ts"),
      'export default { events: { "turn.started"() {}, "turn.completed"() {} } };'
    );
    await writeFile(
      join(agentRoot, "skills", "review", "SKILL.md"),
      "---\nname: review\ndescription: Review work\nlicense: Apache-2.0\n---\nReview carefully."
    );
    await writeFile(
      join(agentRoot, "sandbox.ts"),
      'export default { backend: { kind: "local", secret() {} }, bootstrap() {} };'
    );
    await writeFile(
      join(agentRoot, "sandbox", "workspace", "README.md"),
      "workspace"
    );
    await writeFile(
      join(agentRoot, "instrumentation.ts"),
      'export default { recordInputs: false, events: { "turn.started"() {} } };'
    );

    const loaded = await loadAgent({ startPath: root });

    expect(loaded.manifest.channels).toEqual([
      {
        logicalPath: "channels/api.ts",
        metadata: { source: "api" },
        name: "api",
        routes: [{ method: "POST", path: "/run" }],
        sourceId: "channels/api.ts",
        sourceKind: "module",
      },
    ]);
    expect(loaded.manifest.connections).toEqual([
      expect.objectContaining({
        name: "search",
        protocol: "mcp",
        url: "https://mcp.example.test",
      }),
    ]);
    expect(loaded.manifest.hooks).toEqual([
      expect.objectContaining({
        eventNames: ["turn.completed", "turn.started"],
        name: "audit",
      }),
    ]);
    expect(loaded.manifest.skills).toEqual([
      expect.objectContaining({
        description: "Review work",
        license: "Apache-2.0",
        markdown: "Review carefully.",
        name: "review",
      }),
    ]);
    expect(loaded.manifest.sandbox?.backend).toEqual({ kind: "local" });
    expect(loaded.manifest.sandbox?.hasBootstrap).toBeTrue();
    expect(loaded.manifest.sandboxWorkspace).toEqual([
      expect.objectContaining({ logicalPath: "sandbox/workspace/README.md" }),
    ]);
    expect(loaded.manifest.instrumentation?.eventNames).toEqual([
      "turn.started",
    ]);
    expect(loaded.manifest.instrumentation?.recordInputs).toBeFalse();
    expect(JSON.parse(JSON.stringify(loaded.manifest))).toEqual(
      loaded.manifest
    );
  });

  test("mounts source-backed extensions into namespaced manifest and module scopes", async () => {
    const root = await _fixture();
    const agentRoot = join(root, "agent");
    const extensionRoot = join(root, "crm", "extension");
    await mkdir(join(agentRoot, "extensions"), { recursive: true });
    await mkdir(join(extensionRoot, "tools"), { recursive: true });
    await writeFile(
      join(agentRoot, "agent.ts"),
      'export default { model: "test/model" };'
    );
    await writeFile(join(agentRoot, "instructions.md"), "Be useful.");
    await writeFile(
      join(root, "crm", "package.json"),
      JSON.stringify({
        name: "@acme/crm",
        type: "module",
        exports: "./extension/extension.ts",
        eve: { extension: { source: "./extension" } },
      })
    );
    const extensionApi = pathToFileURL(
      join(import.meta.dir, "..", "extension", "index.ts")
    ).href;
    await writeFile(
      join(extensionRoot, "extension.ts"),
      [
        `import { defineExtension } from ${JSON.stringify(extensionApi)};`,
        "const schema = {",
        '  "~standard": { version: 1, vendor: "fixture", validate: value => ({ value }) },',
        "};",
        "export default defineExtension({ config: schema });",
      ].join("\n")
    );
    await writeFile(
      join(extensionRoot, "tools", "lookup.ts"),
      [
        'import extension from "../extension";',
        "export default () => ({",
        "  description: `Lookup ${extension.config.tenant}` ,",
        '  inputSchema: { type: "object" },',
        "  execute() {},",
        "});",
      ].join("\n")
    );
    await writeFile(
      join(agentRoot, "extensions", "crm.ts"),
      'import crm from "../../crm/extension/extension.ts"; export default crm({ tenant: "acme" });'
    );

    const first = await loadAgent({ startPath: root });

    expect(first.manifest.extensions).toEqual([
      expect.objectContaining({
        namespace: "crm",
        packageName: "@acme/crm",
        sourceRoot: extensionRoot,
      }),
    ]);
    const extensionTool = first.manifest.tools.find(
      (tool) => tool.name === "crm__lookup"
    );
    expect(extensionTool?.description).toBe("Lookup acme");
    expect(
      first.moduleMap.nodes["extension:crm"]?.modules["tools/lookup.ts"]
    ).toBeDefined();

    await writeFile(
      join(extensionRoot, "tools", "lookup.ts"),
      'export default { description: "Changed", inputSchema: {}, execute() {} };'
    );
    const second = await loadAgent({ startPath: root });
    expect(second.sourceFingerprint).not.toBe(first.sourceFingerprint);
  });

  test("applies directory-mount extension overrides in the consumer scope", async () => {
    const root = await _fixture();
    const agentRoot = join(root, "agent");
    const mountRoot = join(agentRoot, "extensions", "crm");
    const extensionRoot = join(root, "crm", "extension");
    await mkdir(join(mountRoot, "tools"), { recursive: true });
    await mkdir(join(extensionRoot, "tools"), { recursive: true });
    await writeFile(
      join(agentRoot, "agent.ts"),
      'export default { model: "test/model" };'
    );
    await writeFile(join(agentRoot, "instructions.md"), "Be useful.");
    await writeFile(
      join(root, "crm", "package.json"),
      JSON.stringify({
        name: "@acme/crm-overrides",
        type: "module",
        exports: "./extension/extension.ts",
        llmSpace: { extension: { source: "./extension" } },
      })
    );
    await writeFile(join(extensionRoot, "extension.ts"), "export default {};");
    await writeFile(
      join(extensionRoot, "tools", "lookup.ts"),
      'export default { description: "Base", inputSchema: {}, execute() {} };'
    );
    await writeFile(
      join(mountRoot, "extension.ts"),
      'export { default } from "../../../crm/extension/extension.ts";'
    );
    await writeFile(
      join(mountRoot, "tools", "lookup.ts"),
      'export default { description: "Override", inputSchema: {}, execute() {} };'
    );

    const loaded = await loadAgent({ startPath: root });

    const overriddenTools = loaded.manifest.tools.filter(
      (tool) => tool.name === "crm__lookup"
    );
    expect(overriddenTools).toHaveLength(1);
    expect(overriddenTools[0]?.description).toBe("Override");
    expect(
      loaded.moduleMap.nodes["extension-override:crm"]?.modules[
        "tools/lookup.ts"
      ]
    ).toBeDefined();
  });

  test("rejects module exports that do not match their harness slot", async () => {
    const root = await _fixture();
    await writeFile(
      join(root, "agent", "agent.ts"),
      'export default { model: "test/model" };'
    );
    await writeFile(join(root, "agent", "instructions.md"), "Be useful.");
    await writeFile(
      join(root, "agent", "tools", "broken.ts"),
      "export default { execute() {} };"
    );

    try {
      await loadAgent({ startPath: root });
      throw new Error("expected loadAgent to reject");
    } catch (error) {
      expect(error).toBeInstanceOf(AgentLoadError);
      const [diagnostic] = (error as AgentLoadError).diagnostics;
      expect(diagnostic?.code).toBe("load/tool-definition-invalid");
      expect(diagnostic?.sourcePath).toBe(
        join(root, "agent", "tools", "broken.ts")
      );
    }
  });

  test("loads flat remote subagents and rejects missing subagent descriptions", async () => {
    const root = await _fixture();
    await mkdir(join(root, "agent", "subagents"), { recursive: true });
    await writeFile(
      join(root, "agent", "agent.ts"),
      'export default { model: "test/model" };'
    );
    await writeFile(join(root, "agent", "instructions.md"), "Coordinate.");
    const remotePath = join(root, "agent", "subagents", "weather.ts");
    await writeFile(
      remotePath,
      'export default { kind: "remote", path: "/llm-space/v1/session", url: "https://example.test" };'
    );

    const invalidRemote = await _captureLoadError(root);
    expect(invalidRemote.diagnostics.map((item) => item.code)).toEqual([
      "load/subagent-description-missing",
    ]);

    const validRoot = await _fixture();
    await mkdir(join(validRoot, "agent", "subagents"), { recursive: true });
    await writeFile(
      join(validRoot, "agent", "agent.ts"),
      'export default { model: "test/model" };'
    );
    await writeFile(join(validRoot, "agent", "instructions.md"), "Coordinate.");
    await writeFile(
      join(validRoot, "agent", "subagents", "weather.ts"),
      'export default { kind: "remote", path: "/llm-space/v1/session", url: "https://example.test", description: "Check weather" };'
    );
    const loaded = await loadAgent({ startPath: validRoot });
    expect(loaded.manifest.subagents[0]).toMatchObject({
      agentId: "weather",
      agent: {
        kind: "remote",
        description: "Check weather",
        url: "https://example.test",
      },
    });
  });

  test("rejects malformed definitions in every authored harness slot", async () => {
    const root = await _fixture();
    const agentRoot = join(root, "agent");
    await Promise.all(
      ["channels", "connections", "hooks", "schedules", "skills"].map(
        (directory) => mkdir(join(agentRoot, directory), { recursive: true })
      )
    );
    await writeFile(join(agentRoot, "agent.ts"), "export default {};");
    await writeFile(join(agentRoot, "instructions.ts"), "export default {};");
    await writeFile(
      join(agentRoot, "channels", "bad.ts"),
      "export default {};"
    );
    await writeFile(
      join(agentRoot, "connections", "bad.ts"),
      "export default {};"
    );
    await writeFile(
      join(agentRoot, "hooks", "bad.ts"),
      "export default { events: 1 };"
    );
    await writeFile(
      join(agentRoot, "schedules", "bad.ts"),
      "export default {};"
    );
    await writeFile(join(agentRoot, "skills", "bad.ts"), "export default {};");
    await writeFile(join(agentRoot, "sandbox.ts"), 'export default "bad";');
    await writeFile(
      join(agentRoot, "instrumentation.ts"),
      'export default "bad";'
    );

    const invalid = await _captureLoadError(root);
    const codes = invalid.diagnostics.map((item) => item.code);
    for (const expectedCode of [
      "load/agent-definition-invalid",
      "load/instructions-definition-invalid",
      "load/channel-definition-invalid",
      "load/connection-definition-invalid",
      "load/hook-definition-invalid",
      "load/schedule-definition-invalid",
      "load/skill-definition-invalid",
      "load/sandbox-definition-invalid",
      "load/instrumentation-definition-invalid",
    ]) {
      expect(codes).toContain(expectedCode);
    }
  });
});
