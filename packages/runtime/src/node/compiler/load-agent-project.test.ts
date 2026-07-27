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
import { AgentSessionState } from "../../runtime/state/agent-session-state";

const ROOTS: string[] = [];

afterEach(async () => {
  await Promise.all(
    ROOTS.splice(0).map(async root => rm(root, { recursive: true }))
  );
});

describe("loadAgentProject", () => {
  test("compiles a one-level declared Subagent as an immutable artifact capability", async () => {
    const root = await _fixture();
    await writeFile(join(root, "instructions.md"), "Delegate research.\n");
    await mkdir(join(root, "subagents", "researcher", "tools"), {
      recursive: true
    });
    await writeFile(
      join(root, "subagents", "researcher", "agent.ts"),
      `import { defineAgent } from "@llm-space/runtime";
      export default defineAgent({
        description: "Research one bounded question.",
        model: "fake/research-model",
        reasoning: "high"
      });`
    );
    await writeFile(
      join(root, "subagents", "researcher", "instructions.md"),
      "Return evidence only.\n"
    );
    await writeFile(
      join(root, "subagents", "researcher", "tools", "lookup.ts"),
      `import { defineTool } from "@llm-space/runtime/tools";
      import { Type } from "typebox";
      export default defineTool({
        description: "Look up one fact.",
        inputSchema: Type.Object({ query: Type.String() }),
        execute: ({ query }) => query
      });`
    );

    const snapshot = await loadAgentProject(root);

    expect(snapshot.diagnostics).toEqual([]);
    expect(snapshot.subagents).toHaveLength(1);
    expect(snapshot.subagents?.[0]).toMatchObject({
      id: "researcher",
      description: "Research one bounded question.",
      project: {
        instructions: "Return evidence only.\n",
        definition: {
          description: "Research one bounded question.",
          model: { provider: "fake", id: "research-model" },
          limits: { maxModelCallsPerRun: 25 },
          reasoning: "high"
        }
      }
    });
    expect(snapshot.subagents?.[0]?.project.tools.map(tool => tool.name))
      .toEqual(["lookup"]);
    expect(Object.isFrozen(snapshot.subagents?.[0]?.project)).toBe(true);
    expect(snapshot.artifact.fingerprints.capabilities.entries)
      .toContainEqual(expect.objectContaining({ id: "subagent:researcher" }));
  });

  test("rejects unsupported or ambiguous Subagent source at build time", async () => {
    const root = await _fixture();
    await writeFile(join(root, "instructions.md"), "Delegate carefully.\n");
    await mkdir(join(root, "tools"));
    await writeFile(
      join(root, "tools", "researcher.ts"),
      `import { defineTool } from "@llm-space/runtime/tools";
      import { Type } from "typebox";
      export default defineTool({
        description: "Conflicting root tool.",
        inputSchema: Type.Object({}),
        execute: () => "root"
      });`
    );
    await mkdir(
      join(root, "subagents", "researcher", "outputs"),
      { recursive: true }
    );
    await mkdir(
      join(root, "subagents", "researcher", "subagents", "nested"),
      { recursive: true }
    );
    await writeFile(
      join(root, "subagents", "researcher", "agent.ts"),
      `export default { model: "fake/research-model" };`
    );
    await writeFile(
      join(root, "subagents", "researcher", "instructions.md"),
      "Research.\n"
    );
    await writeFile(
      join(root, "subagents", "researcher", "outputs", "answer.ts"),
      "export default {};"
    );

    const snapshot = await loadAgentProject(root);

    expect(snapshot.subagents).toEqual([]);
    expect(snapshot.diagnostics.map(diagnostic => diagnostic.code))
      .toEqual(expect.arrayContaining([
        "subagent_nested_unsupported",
        "tool_name_duplicate"
      ]));
  });

  test("requires a description and rejects outputs inside an otherwise valid Subagent", async () => {
    const root = await _fixture();
    await writeFile(join(root, "instructions.md"), "Delegate carefully.\n");
    await mkdir(join(root, "subagents", "worker", "outputs"), {
      recursive: true
    });
    await writeFile(
      join(root, "subagents", "worker", "agent.ts"),
      `export default { model: "fake/worker" };`
    );
    await writeFile(
      join(root, "subagents", "worker", "instructions.md"),
      "Work.\n"
    );
    await writeFile(
      join(root, "subagents", "worker", "outputs", "answer.ts"),
      "export default {};"
    );

    const snapshot = await loadAgentProject(root);

    expect(snapshot.subagents).toEqual([]);
    expect(snapshot.diagnostics.map(diagnostic => diagnostic.code))
      .toEqual(expect.arrayContaining([
        "subagent_description_missing",
        "subagent_output_unsupported"
      ]));
  });

  test("rejects connections inside a Subagent until Hosts can execute them", async () => {
    const root = await _fixture();
    await writeFile(join(root, "instructions.md"), "Delegate carefully.\n");
    await mkdir(join(root, "subagents", "worker", "connections"), {
      recursive: true
    });
    await writeFile(
      join(root, "subagents", "worker", "agent.ts"),
      `export default {
        description: "Work without inherited connections.",
        model: "fake/worker"
      };`
    );
    await writeFile(
      join(root, "subagents", "worker", "instructions.md"),
      "Work.\n"
    );
    await writeFile(
      join(root, "subagents", "worker", "connections", "remote.ts"),
      "export default {};"
    );

    const snapshot = await loadAgentProject(root);

    expect(snapshot.subagents).toEqual([]);
    expect(snapshot.diagnostics).toContainEqual(expect.objectContaining({
      code: "subagent_connection_unsupported",
      message: "Subagent connections are not supported in V1"
    }));
  });

  test("derives Sandbox revalidation fingerprints from the abstract requirement and seed", async () => {
    const root = await _fixture();
    await writeFile(join(root, "instructions.md"), "Delegate in Sandbox.\n");
    for (const agentRoot of [root, join(root, "subagents", "worker")]) {
      await mkdir(join(agentRoot, "sandbox", "workspace"), {
        recursive: true
      });
      await writeFile(
        join(agentRoot, "sandbox", "sandbox.ts"),
        `import { defineSandbox } from "@llm-space/runtime/sandbox";
        export default defineSandbox({});`
      );
      await writeFile(
        join(agentRoot, "sandbox", "workspace", "seed.txt"),
        "same seed\n"
      );
    }
    await writeFile(
      join(root, "subagents", "worker", "agent.ts"),
      `export default {
        description: "Work in the same Sandbox shape.",
        model: "fake/worker"
      };`
    );
    await writeFile(
      join(root, "subagents", "worker", "instructions.md"),
      "Work.\n"
    );

    const first = await loadAgentProject(root);
    await writeFile(
      join(root, "subagents", "worker", "sandbox", "workspace", "seed.txt"),
      "different seed\n"
    );
    const second = await loadAgentProject(root);

    expect(first.sandbox?.revalidationFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(first.subagents?.[0]?.project.sandbox?.revalidationFingerprint)
      .toBe(first.sandbox?.revalidationFingerprint);
    expect(second.subagents?.[0]?.project.sandbox?.revalidationFingerprint)
      .not.toBe(second.sandbox?.revalidationFingerprint);
  });

  test("compiles a Sandbox requirement and immutable workspace seed", async () => {
    const root = await _fixture();
    await writeFile(join(root, "instructions.md"), "Inspect the workspace.\n");
    await mkdir(join(root, "sandbox", "workspace", "nested"), {
      recursive: true
    });
    await writeFile(
      join(root, "sandbox", "sandbox.ts"),
      `import { defineSandbox } from "@llm-space/runtime/sandbox";
      export default defineSandbox({});`
    );
    await writeFile(
      join(root, "sandbox", "workspace", "README.md"),
      "seed\n"
    );
    await writeFile(
      join(root, "sandbox", "workspace", "nested", "data.bin"),
      Buffer.from([0, 255, 1])
    );

    const snapshot = await loadAgentProject(root);

    expect(snapshot.diagnostics).toEqual([]);
    expect(snapshot.sandbox).toEqual({
      revalidationFingerprint:
        "5790dea47ce2eeaf14c19c89f5d18ead8bbe2fc73898114d3d6e0609798c7abe",
      sourcePath: "sandbox/sandbox.ts",
      workspace: [
        {
          path: "README.md",
          size: 5,
          fingerprint:
            "4a6689419b00b11700c9b6246bcfa8936c8f5e1e824db3a7e57030e2d1c1a684",
          contentBase64: "c2VlZAo="
        },
        {
          path: "nested/data.bin",
          size: 3,
          fingerprint:
            "47ffa3ea45a70b8a41c2c0825df323c00a8b7a01c1ea06083cc41dddcc001123",
          contentBase64: "AP8B"
        }
      ]
    });
    expect(Object.isFrozen(snapshot.sandbox?.workspace)).toBe(true);
    expect(snapshot.artifact.fingerprints.capabilities.entries)
      .toContainEqual(expect.objectContaining({ id: "sandbox" }));
    expect(snapshot.artifact.fingerprints.sources.entries.map(entry => entry.id))
      .toEqual(expect.arrayContaining([
        "sandbox/sandbox.ts",
        "sandbox/workspace/README.md",
        "sandbox/workspace/nested/data.bin"
      ]));
  });

  test("rejects a workspace file swapped to a symlink after discovery", async () => {
    const root = await _fixture();
    const workspaceFile = join(root, "sandbox", "workspace", "seed.txt");
    const outsideFile = join(root, "outside.txt");
    await writeFile(join(root, "instructions.md"), "Inspect the workspace.\n");
    await mkdir(join(root, "sandbox", "workspace"), { recursive: true });
    await writeFile(workspaceFile, "discovered\n");
    await writeFile(outsideFile, "outside-secret\n");
    await writeFile(
      join(root, "sandbox", "sandbox.ts"),
      `import { rm, symlink } from "node:fs/promises";
      import { defineSandbox } from "@llm-space/runtime/sandbox";
      await rm(${JSON.stringify(workspaceFile)});
      await symlink(${JSON.stringify(outsideFile)}, ${JSON.stringify(workspaceFile)});
      export default defineSandbox({});`
    );

    const snapshot = await loadAgentProject(root);

    expect(snapshot.sandbox).toBeUndefined();
    expect(snapshot.diagnostics).toContainEqual(expect.objectContaining({
      code: "sandbox_import_failed",
      message: expect.stringContaining("Unable to import Sandbox definition")
    }));
    expect(JSON.stringify(snapshot.artifact)).not.toContain("outside-secret");
  });

  test("rejects a workspace parent swapped to a symlink after discovery", async () => {
    const root = await _fixture();
    const workspaceParent = join(root, "sandbox", "workspace", "nested");
    const outsideParent = join(root, "outside");
    await writeFile(join(root, "instructions.md"), "Inspect the workspace.\n");
    await mkdir(workspaceParent, { recursive: true });
    await mkdir(outsideParent);
    await writeFile(join(workspaceParent, "seed.txt"), "discovered\n");
    await writeFile(join(outsideParent, "seed.txt"), "outside-secret\n");
    await writeFile(
      join(root, "sandbox", "sandbox.ts"),
      `import { rm, symlink } from "node:fs/promises";
      import { defineSandbox } from "@llm-space/runtime/sandbox";
      await rm(${JSON.stringify(workspaceParent)}, { recursive: true });
      await symlink(${JSON.stringify(outsideParent)}, ${JSON.stringify(workspaceParent)});
      export default defineSandbox({});`
    );

    const snapshot = await loadAgentProject(root);

    expect(snapshot.sandbox).toBeUndefined();
    expect(snapshot.diagnostics).toContainEqual(expect.objectContaining({
      code: "sandbox_import_failed",
      message: expect.stringContaining("must remain a regular file")
    }));
    expect(JSON.stringify(snapshot.artifact)).not.toContain("outside-secret");
  });

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
      limits: { maxModelCallsPerRun: 25 },
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

  test("compiles canonical ExecutionEnv helpers into capability identity", async () => {
    const root = await _fixture();
    await writeFile(join(root, "instructions.md"), "Use portable helpers.\n");
    await mkdir(join(root, "tools"));
    for (const kind of ["bash", "read", "write"] as const) {
      await writeFile(
        join(root, "tools", `${kind}.ts`),
        `import { define${kind[0]?.toUpperCase()}${kind.slice(1)}Tool, once } from "@llm-space/runtime/tools";
        export default define${kind[0]?.toUpperCase()}${kind.slice(1)}Tool({ approval: once() });`
      );
    }

    const snapshot = await loadAgentProject(root);

    expect(snapshot.diagnostics).toEqual([]);
    expect(snapshot.tools.map(tool => ({
      name: tool.name,
      approval: tool.approval,
      kind: tool.executionEnvToolKind,
      required: tool.requiresExecutionEnv
    }))).toEqual([
      { name: "bash", approval: "once", kind: "bash", required: true },
      { name: "read", approval: "once", kind: "read", required: true },
      { name: "write", approval: "once", kind: "write", required: true }
    ]);
    expect(snapshot.artifact.fingerprints.capabilities.entries
      .filter(entry => entry.id.startsWith("tool:"))
      .map(entry => entry.id)).toEqual(["tool:bash", "tool:read", "tool:write"]);
  });

  test("rejects renamed and dynamically-created ExecutionEnv helpers", async () => {
    const root = await _fixture();
    await writeFile(join(root, "instructions.md"), "Reject disguised authority.\n");
    await mkdir(join(root, "tools"));
    await writeFile(
      join(root, "tools", "inspect.ts"),
      `import { defineReadTool } from "@llm-space/runtime/tools";
      export default defineReadTool();`
    );
    await writeFile(
      join(root, "tools", "dynamic.ts"),
      `import { defineDynamic, defineBashTool } from "@llm-space/runtime/tools";
      export default defineDynamic({ events: {
        "turn.started": () => ({ bash: defineBashTool() })
      }});`
    );

    const snapshot = await loadAgentProject(root);

    expect(snapshot.tools).toEqual([]);
    expect(snapshot.diagnostics.map(item => item.code)).toEqual([
      "tool_import_failed",
      "tool_export_invalid"
    ]);
    expect(snapshot.diagnostics.map(item => item.message).join("\n"))
      .toContain("must be named read.ts or read.js");
  });

  test("composes root, static, and dynamic instruction entries deterministically", async () => {
    const root = await _fixture();
    await writeFile(join(root, "instructions.md"), "Root.\n");
    await mkdir(join(root, "instructions"));
    await mkdir(join(root, "state"));
    await writeFile(
      join(root, "state", "locale.ts"),
      `import { defineState } from "@llm-space/runtime/state";
      import { Type } from "typebox";
      export default defineState({
        name: "test.locale",
        version: 1,
        schema: Type.Object({ value: Type.String() }),
        initial: { value: "en" }
      });`
    );
    await writeFile(join(root, "instructions", "20-policy.md"), "Policy.\n");
    await writeFile(
      join(root, "instructions", "10-static.ts"),
      `import { defineInstructions } from "@llm-space/runtime/instructions";
      export default defineInstructions({ markdown: "Static." });`
    );
    await writeFile(
      join(root, "instructions", "30-dynamic.ts"),
      `import { defineDynamic, defineInstructions } from "@llm-space/runtime/instructions";
      import locale from "../state/locale";
      export default defineDynamic({ events: {
        "turn.started": (_event, context) => defineInstructions({
          markdown: "Current: " + context.session.auth.current.principalId
            + ":" + locale.get().value
        })
      }});`
    );

    const snapshot = await loadAgentProject(root);

    expect(snapshot.diagnostics).toEqual([]);
    expect(snapshot.instructions).toBe("Root.\n\nStatic.\n\nPolicy.");
    expect(snapshot.instructionEntries?.map(entry => [
      entry.kind,
      entry.sourcePath
    ])).toEqual([
      ["static", "instructions.md"],
      ["static", "instructions/10-static.ts"],
      ["static", "instructions/20-policy.md"],
      ["dynamic", "instructions/30-dynamic.ts"]
    ]);
    expect(snapshot.artifact.fingerprints.capabilities.entries.map(
      entry => entry.id
    )).toContain("instruction:instructions/30-dynamic.ts");
  });

  test("uses code-point ordering for instruction entry filenames", async () => {
    const root = await _fixture();
    await writeFile(join(root, "instructions.md"), "Root.\n");
    await mkdir(join(root, "instructions"));
    await writeFile(join(root, "instructions", "Z.md"), "Upper.\n");
    await writeFile(join(root, "instructions", "a.md"), "Lower.\n");

    const snapshot = await loadAgentProject(root);

    expect(snapshot.diagnostics).toEqual([]);
    expect(snapshot.instructionEntries?.map(entry => entry.sourcePath)).toEqual([
      "instructions.md",
      "instructions/Z.md",
      "instructions/a.md"
    ]);
  });

  test("rejects nested, unsupported, symbolic, and invalid instruction entries", async () => {
    const root = await _fixture();
    await writeFile(join(root, "instructions.md"), "Root.\n");
    await mkdir(join(root, "instructions"));
    await mkdir(join(root, "instructions", "nested"));
    await writeFile(join(root, "instructions", "unsupported.txt"), "No.");
    await writeFile(join(root, "outside.md"), "Outside.\n");
    await symlink(join(root, "outside.md"), join(root, "instructions", "linked.md"));
    await writeFile(
      join(root, "instructions", "invalid.ts"),
      `export default { markdown: "Not branded." };`
    );

    const snapshot = await loadAgentProject(root);

    expect(snapshot.instructionEntries?.map(entry => entry.sourcePath)).toEqual([
      "instructions.md"
    ]);
    expect(snapshot.diagnostics.map(item => item.code)).toEqual([
      "instruction_entry_invalid",
      "instruction_entry_invalid",
      "instruction_entry_invalid",
      "instruction_entry_import_failed"
    ]);
    expect(snapshot.diagnostics.at(-1)?.message).toContain(
      "must default-export defineInstructions(...) or defineDynamic(...)"
    );
  });

  test("confines instruction imports to the authored instructions and state surface", async () => {
    const root = await _fixture();
    await writeFile(join(root, "instructions.md"), "Root.\n");
    await mkdir(join(root, "instructions"));
    await mkdir(join(root, "tools"));
    await writeFile(
      join(root, "tools", "unsafe.ts"),
      `import { defineTool } from "@llm-space/runtime/tools";
      import { Type } from "typebox";
      export default defineTool({
        description: "Must not be callable from instructions.",
        inputSchema: Type.Object({}),
        execute() { return "bypassed"; }
      });`
    );
    await writeFile(
      join(root, "instructions", "10-tool.ts"),
      `import { defineDynamic, defineInstructions } from "@llm-space/runtime/instructions";
      import unsafe from "../tools/unsafe";
      export default defineDynamic({ events: {
        "turn.started": () => defineInstructions({ markdown: unsafe.execute() })
      }});`
    );
    await writeFile(
      join(root, "instructions", "20-node.ts"),
      `import { readFileSync } from "node:fs";
      import { defineInstructions } from "@llm-space/runtime/instructions";
      export default defineInstructions({ markdown: readFileSync("/tmp/value", "utf8") });`
    );
    await writeFile(
      join(root, "instructions", "30-global.ts"),
      `import { defineDynamic, defineInstructions } from "@llm-space/runtime/instructions";
      export default defineDynamic({ events: {
        "turn.started": async () => {
          await fetch("https://authority.invalid");
          return defineInstructions({ markdown: "unsafe" });
        }
      }});`
    );

    const snapshot = await loadAgentProject(root);

    expect(snapshot.instructionEntries?.map(entry => entry.sourcePath)).toEqual([
      "instructions.md"
    ]);
    expect(snapshot.diagnostics.map(item => item.code)).toEqual([
      "instruction_entry_import_failed",
      "instruction_entry_import_failed",
      "instruction_entry_import_failed"
    ]);
    expect(snapshot.diagnostics.map(item => item.message).join("\n")).toContain(
      "Instruction entries may import only"
    );
    expect(snapshot.diagnostics.map(item => item.message).join("\n")).toContain(
      "cannot access Host authority through fetch"
    );
  });

  test("compiles named versioned state into artifact capability and schema identity", async () => {
    const root = await _fixture();
    await writeFile(join(root, "instructions.md"), "Track a counter.\n");
    await mkdir(join(root, "state"));
    await writeFile(
      join(root, "state", "counter.ts"),
      `import { defineState } from "@llm-space/runtime/state";
      import { Type } from "typebox";
      export default defineState({
        name: "demo.counter",
        version: 1,
        schema: Type.Object({ count: Type.Number() }),
        initial: { count: 0 }
      });`
    );

    const snapshot = await loadAgentProject(root);

    expect(snapshot.diagnostics).toEqual([]);
    expect(snapshot.stateDefinitions).toEqual([
      expect.objectContaining({
        name: "demo.counter",
        version: 1,
        initial: { count: 0 },
        sourcePath: "state/counter.ts",
        schemaFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/)
      })
    ]);
    expect(Object.isFrozen(snapshot.stateDefinitions)).toBe(true);
    expect(snapshot.artifact.fingerprints.capabilities.entries)
      .toContainEqual(expect.objectContaining({ id: "state:demo.counter" }));
    expect(snapshot.artifact.fingerprints.schemas.entries)
      .toContainEqual(expect.objectContaining({ id: "state:demo.counter" }));
  });

  test("compiles filename-owned structured outputs into artifact identity", async () => {
    const root = await _fixture();
    await writeFile(join(root, "instructions.md"), "Return a typed answer.\n");
    await mkdir(join(root, "outputs"));
    await writeFile(
      join(root, "outputs", "answer.ts"),
      `import { defineOutput } from "@llm-space/runtime/outputs";
      import { Type } from "typebox";
      export default defineOutput({
        description: "A typed answer.",
        schema: Type.Object({ answer: Type.String() })
      });`
    );

    const snapshot = await loadAgentProject(root);

    expect(snapshot.diagnostics).toEqual([]);
    expect(snapshot.outputDefinitions).toEqual([
      expect.objectContaining({
        name: "answer",
        description: "A typed answer.",
        sourcePath: "outputs/answer.ts",
        schemaFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/)
      })
    ]);
    expect(snapshot.artifact.fingerprints.capabilities.entries)
      .toContainEqual(expect.objectContaining({ id: "output:answer" }));
    expect(snapshot.artifact.fingerprints.schemas.entries)
      .toContainEqual(expect.objectContaining({ id: "output:answer" }));
  });

  test("rejects reserved, duplicate, unbranded, and extended output definitions", async () => {
    const root = await _fixture();
    await writeFile(join(root, "instructions.md"), "Output validation.\n");
    await mkdir(join(root, "outputs"));
    const definition = (extra = "") =>
      `import { defineOutput } from "@llm-space/runtime/outputs";
      import { Type } from "typebox";
      export default defineOutput({
        description: "A typed answer.",
        schema: Type.Object({ answer: Type.String() })${extra}
      });`;
    await Promise.all([
      writeFile(join(root, "outputs", "answer.ts"), definition()),
      writeFile(join(root, "outputs", "answer.js"), definition()),
      writeFile(join(root, "outputs", "final_output.ts"), definition()),
      writeFile(join(root, "outputs", "raw.ts"), "export default {};"),
      writeFile(join(root, "outputs", "extended.ts"), definition(", default: {}"))
    ]);

    const snapshot = await loadAgentProject(root);

    expect(snapshot.outputDefinitions?.map(output => output.name)).toEqual([
      "answer"
    ]);
    expect(snapshot.diagnostics.map(item => item.code)).toEqual([
      "output_name_duplicate",
      "output_import_failed",
      "output_export_invalid",
      "output_import_failed"
    ]);
  });

  test("rejects invalid, duplicate, reserved, and oversized state declarations", async () => {
    const root = await _fixture();
    await writeFile(join(root, "instructions.md"), "State validation.\n");
    await mkdir(join(root, "state"));
    const definition = (name: string, version: string, initial: string) =>
      `import { defineState } from "@llm-space/runtime/state";
      import { Type } from "typebox";
      export default defineState({
        name: ${JSON.stringify(name)},
        version: ${version},
        schema: Type.Object({ value: Type.String() }),
        initial: ${initial}
      });`;
    await Promise.all([
      writeFile(
        join(root, "state", "duplicate-a.ts"),
        definition("demo.duplicate", "1", `{ value: "a" }`)
      ),
      writeFile(
        join(root, "state", "duplicate-b.ts"),
        definition("demo.duplicate", "1", `{ value: "b" }`)
      ),
      writeFile(
        join(root, "state", "reserved.ts"),
        definition("llm-space.internal", "1", `{ value: "x" }`)
      ),
      writeFile(
        join(root, "state", "version.ts"),
        definition("demo.version", "0", `{ value: "x" }`)
      ),
      writeFile(
        join(root, "state", "invalid.ts"),
        definition("demo.invalid", "1", `{ value: 2 }`)
      ),
      writeFile(
        join(root, "state", "oversized.ts"),
        definition(
          "demo.oversized",
          "1",
          `{ value: ${JSON.stringify("x".repeat(65 * 1024))} }`
        )
      )
    ]);

    const snapshot = await loadAgentProject(root);
    const messages = snapshot.diagnostics.map(item => item.message).join("\n");

    expect(snapshot.diagnostics.map(item => item.code)).toContain(
      "state_name_duplicate"
    );
    expect(messages).toContain("reserved");
    expect(messages).toContain("positive integer");
    expect(messages).toContain("does not match its schema");
    expect(messages).toContain("exceeds 65536 bytes");
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

  test("rejects duplicate authored environment names before import", async () => {
    const root = await _fixture();
    await writeFile(join(root, "instructions.md"), "Test.\n");
    await writeFile(
      join(root, "agent.ts"),
      `export default {
        model: "fake/model",
        environment: {
          API_KEY: { kind: "secret", required: true },
          API_KEY: { kind: "config", required: false }
        }
      };`
    );

    const snapshot = await loadAgentProject(root);

    expect(snapshot.definition).toBeUndefined();
    expect(snapshot.diagnostics).toEqual([
      expect.objectContaining({
        code: "definition_import_failed",
        message: expect.stringContaining("Duplicate authored object key: API_KEY")
      })
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
    expect((await _executeInScope(
      async () => second.tools[0]!.execute("call", {})
    )).content[0]).toEqual({
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
    expect((await _executeInScope(
      async () => first.tools[0]!.execute("call", {})
    )).content[0]).toEqual({
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
    expect((await _executeInScope(
      async () => second.tools[0]!.execute("call", {})
    )).content[0]).toEqual({
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
      model: { provider: "fake", id: "model-one" },
      limits: { maxModelCallsPerRun: 25 }
    });
    expect(second.definition).toEqual({
      model: { provider: "fake", id: "model-two" },
      limits: { maxModelCallsPerRun: 25 },
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

async function _executeInScope<T>(run: () => Promise<T>): Promise<T> {
  return new AgentSessionState({
    context: {
      id: "compiler-test-session",
      auth: {
        initiator: {
          issuer: "test",
          principalId: "test",
          principalType: "runtime"
        },
        current: {
          issuer: "test",
          principalId: "test",
          principalType: "runtime"
        }
      },
      channel: { kind: "test" },
      turn: { id: "turn-1", sequence: 1 }
    },
    definitions: []
  }).executeTool(run);
}
