import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "bun:test";

import {
  AGENT_BUNDLE_COMPILER_SUPPORT_FILENAME,
  createAgentProjectBundle,
  generateAgentBundleCompilerSupport,
  loadAgentProjectBundle
} from "../../../src/node";
import { getRejection } from "../../test-utils/get-rejection";

const ROOTS: string[] = [];

afterEach(async () => {
  await Promise.all(ROOTS.splice(0).map(
    async root => rm(root, { recursive: true, force: true })
  ));
});

describe("createAgentProjectBundle compiler support", () => {
  test("matches source bytes and preserves every authored SDK surface", async () => {
    const root = await _fixture();
    const supportPath = await _support();

    const source = await createAgentProjectBundle(root);
    const packaged = await createAgentProjectBundle(root, {
      compilerSupportPath: supportPath
    });

    expect(packaged).toEqual(source);
    const bundlePath = path.join(root, "packaged-agent.mjs");
    await writeFile(bundlePath, packaged.bundle, "utf8");
    const project = await loadAgentProjectBundle(bundlePath, packaged.artifact);
    expect(project.instructionEntries?.map(entry => entry.kind)).toEqual([
      "static",
      "dynamic"
    ]);
    expect(project.tools.map(tool => tool.name)).toEqual(["echo"]);
    expect(project.dynamicToolResolvers?.map(resolver => resolver.sourcePath))
      .toEqual(["tools/dynamic.ts"]);
    expect(project.stateDefinitions?.map(state => state.name)).toEqual([
      "support.counter"
    ]);
    expect(project.outputDefinitions?.map(output => output.name)).toEqual([
      "answer"
    ]);
    expect(project.sandbox?.workspace.map(file => file.path)).toEqual([
      "seed.txt"
    ]);
    expect(project.connections.map(connection => connection.name)).toEqual([
      "fixture"
    ]);
  });

  test("preserves authored import confinement", async () => {
    const root = await _fixture();
    const supportPath = await _support();
    await writeFile(
      path.join(root, "tools", "echo.ts"),
      `import { defineTool } from "@llm-space/runtime/tools";
       import { Type } from "typebox";
       export default defineTool({
         description: "Invalid import",
         inputSchema: Type.Object({ value: Type.String() }),
         async execute({ value }) {
           const dependency = "./dependency";
           await import(dependency);
           return { value };
         }
       });`,
      "utf8"
    );

    const error = await getRejection(createAgentProjectBundle(root, {
      compilerSupportPath: supportPath
    }));
    expect(error.message).toContain("non-literal runtime import");
  });

  test("bundles captured bytes when authored code edits its source", async () => {
    const root = await _fixture();
    const supportPath = await _support();
    const toolPath = path.join(root, "tools", "echo.ts");
    await writeFile(
      toolPath,
      `import { writeFileSync } from "node:fs";
       import { defineTool } from "@llm-space/runtime/tools";
       import { Type } from "typebox";
       writeFileSync(${JSON.stringify(toolPath)}, "changed after capture");
       export default defineTool({
         description: "Capture proof",
         inputSchema: Type.Object({ value: Type.String() }),
         execute({ value }) { return { value }; }
       });`,
      "utf8"
    );

    const packaged = await createAgentProjectBundle(root, {
      compilerSupportPath: supportPath
    });

    expect(packaged.bundle).toContain("changed after capture");
  });
});

async function _support(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "llm-space-support-path-"));
  ROOTS.push(root);
  await generateAgentBundleCompilerSupport(root);
  return path.join(root, AGENT_BUNDLE_COMPILER_SUPPORT_FILENAME);
}

async function _fixture(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "llm-space-support-agent-"));
  ROOTS.push(root);
  await writeFile(
    path.join(root, "agent.ts"),
    `import { defineAgent } from "@llm-space/runtime";
     export default defineAgent({ model: "openai/gpt-5.3-codex" });`,
    "utf8"
  );
  await writeFile(path.join(root, "instructions.md"), "Static.\n", "utf8");
  await mkdir(path.join(root, "instructions"));
  await writeFile(
    path.join(root, "instructions", "dynamic.ts"),
    `import { defineDynamic, defineInstructions } from "@llm-space/runtime/instructions";
     export default defineDynamic({
       events: {
         "turn.started": () => defineInstructions({ markdown: "Dynamic." })
       }
     });`,
    "utf8"
  );
  await mkdir(path.join(root, "tools"));
  await writeFile(
    path.join(root, "tools", "echo.ts"),
    `import { defineTool } from "@llm-space/runtime/tools";
     import { Type } from "typebox";
     export default defineTool({
       description: "Echo",
       inputSchema: Type.Object({ value: Type.String() }),
       execute({ value }) { return { value }; }
     });`,
    "utf8"
  );
  await writeFile(
    path.join(root, "tools", "dynamic.ts"),
    `import { defineDynamic, defineTool } from "@llm-space/runtime/tools";
     import { Type } from "typebox";
     export default defineDynamic({
       events: {
         "turn.started": () => ({
           dynamic_echo: defineTool({
             description: "Dynamic echo",
             inputSchema: Type.Object({ value: Type.String() }),
             execute({ value }) { return { value }; }
           })
         })
       }
     });`,
    "utf8"
  );
  await mkdir(path.join(root, "state"));
  await writeFile(
    path.join(root, "state", "counter.ts"),
    `import { defineState } from "@llm-space/runtime/state";
     import { Type } from "typebox";
     export default defineState({
       name: "support.counter",
       version: 1,
       schema: Type.Object({ count: Type.Number() }),
       initial: { count: 0 }
     });`,
    "utf8"
  );
  await mkdir(path.join(root, "outputs"));
  await writeFile(
    path.join(root, "outputs", "answer.ts"),
    `import { defineOutput } from "@llm-space/runtime/outputs";
     import { Type } from "typebox";
     export default defineOutput({
       description: "Answer",
       schema: Type.Object({ answer: Type.String() })
     });`,
    "utf8"
  );
  await mkdir(path.join(root, "connections"));
  await writeFile(
    path.join(root, "connections", "fixture.ts"),
    `import { defineMcpClientConnection } from "@llm-space/runtime/connections";
     export default defineMcpClientConnection({
       url: "https://example.com/mcp",
       description: "Fixture",
       tools: { allow: ["remote_echo"] }
     });`,
    "utf8"
  );
  await mkdir(path.join(root, "sandbox", "workspace"), { recursive: true });
  await writeFile(
    path.join(root, "sandbox", "sandbox.ts"),
    `import { defineSandbox } from "@llm-space/runtime/sandbox";
     export default defineSandbox({});`,
    "utf8"
  );
  await writeFile(
    path.join(root, "sandbox", "workspace", "seed.txt"),
    "seed\n",
    "utf8"
  );
  return root;
}
