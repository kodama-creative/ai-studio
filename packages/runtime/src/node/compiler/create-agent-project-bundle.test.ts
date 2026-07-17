import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, test } from "bun:test";

import { createAgentProjectBundle } from "./create-agent-project-bundle";
import { loadAgentProject } from "./load-agent-project";

const ROOTS: string[] = [];

afterEach(async () => {
  await Promise.all(ROOTS.splice(0).map(async root => rm(root, { recursive: true })));
});

describe("createAgentProjectBundle", () => {
  test("builds the same Agent Artifact into an executable closed bundle", async () => {
    const root = await _fixture();
    const loaded = await loadAgentProject(root);

    const built = await createAgentProjectBundle(root);

    expect(built.artifact).toEqual(loaded.artifact);
    expect(built.environment).toEqual({
      PROVIDER_API_KEY: { kind: "secret", required: true }
    });
    expect(built.bundle).not.toContain(root);
    expect(built.bundle).not.toContain("sourceMappingURL");

    const bundlePath = join(root, "compiled-agent.mjs");
    await writeFile(bundlePath, built.bundle);
    const module = await import(`${pathToFileURL(bundlePath).href}?v=one`) as {
      createAgentProject(artifact: typeof built.artifact): ReturnType<
        typeof loadAgentProject
      > extends Promise<infer T> ? T : never;
    };
    const project = module.createAgentProject(built.artifact);
    expect(project.artifact).toEqual(built.artifact);
    expect(project.definition?.environment).toEqual(built.environment);
    expect(project.tools.map(tool => tool.name)).toEqual(["echo"]);
    expect((await project.tools[0]!.execute("call", { value: "hello" })).details)
      .toEqual({ value: "hello" });
    expect(() => module.createAgentProject({
      ...built.artifact,
      fingerprint: "0".repeat(64)
    })).toThrow("descriptor mismatch");
  });

  test("is deterministic across equivalent absolute project roots", async () => {
    const first = await _fixture();
    const second = await _fixture();

    const firstBuild = await createAgentProjectBundle(first);
    const secondBuild = await createAgentProjectBundle(second);

    expect(firstBuild.artifact).toEqual(secondBuild.artifact);
    expect(firstBuild.bundle).toBe(secondBuild.bundle);
  });

  test("bundles the same captured bytes when authored code edits its source", async () => {
    const root = await _fixture();
    const toolPath = join(root, "tools", "echo.ts");
    const source = `import { writeFileSync } from "node:fs";
      import { defineTool } from "@llm-space/runtime/tools";
      import { Type } from "typebox";
      writeFileSync(${JSON.stringify(toolPath)}, "changed after capture");
      export default defineTool({
        description: "Echo a value.",
        inputSchema: Type.Object({ value: Type.String() }),
        execute({ value }) { return { value }; }
      });`;
    await writeFile(toolPath, source);

    const built = await createAgentProjectBundle(root);

    expect(built.artifact.fingerprints.sources.entries).toContainEqual(
      expect.objectContaining({ id: "tools/echo.ts" })
    );
    expect(built.bundle).toContain("changed after capture");
  });
});

async function _fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "llm-space-oci-bundle-"));
  ROOTS.push(root);
  await writeFile(
    join(root, "agent.ts"),
    `import { defineAgent } from "@llm-space/runtime";
    export default defineAgent({
      model: "openai/gpt-5.3-codex",
      environment: {
        PROVIDER_API_KEY: { kind: "secret", required: true }
      }
    });`
  );
  await writeFile(join(root, "instructions.md"), "Echo the input.\n");
  await mkdir(join(root, "tools"));
  await writeFile(
    join(root, "tools", "echo.ts"),
    `import { defineTool } from "@llm-space/runtime/tools";
    import { Type } from "typebox";
    export default defineTool({
      description: "Echo a value.",
      inputSchema: Type.Object({ value: Type.String() }),
      outputSchema: Type.Object({ value: Type.String() }),
      execute({ value }) { return { value }; }
    });`
  );
  return root;
}
