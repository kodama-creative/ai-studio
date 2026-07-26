import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "bun:test";

import {
  AGENT_BUNDLE_COMPILER_SUPPORT_FILENAME,
  validateAgentBundleCompilerSupport
} from "../../../src/node";
import { loadAgentBundleCompilerSupport } from "../../../src/node/compiler/load-agent-bundle-compiler-support";
import { writeAgentBundleCompilerSupportFixture } from "../../test-utils/write-agent-bundle-compiler-support-fixture";

test("executes only the verified bytes after the source file is swapped", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "llm-space-support-swap-"));
  try {
    const outputPath = path.join(root, "result.txt");
    const supportPath = path.join(
      root,
      AGENT_BUNDLE_COMPILER_SUPPORT_FILENAME
    );
    await writeAgentBundleCompilerSupportFixture(
      root,
      _supportFixtureSource("verified")
    );
    const validated = await validateAgentBundleCompilerSupport(supportPath);

    await writeFile(
      supportPath,
      _supportFixtureSource("swapped"),
      "utf8"
    );
    const compilerSupport = await loadAgentBundleCompilerSupport(validated);
    await compilerSupport.buildAgentProjectBundle({
      authoredRoot: root,
      bundlePath: outputPath,
      entryPath: path.join(root, "entry.mjs"),
      instructionEntryPaths: [],
      toolEntryPaths: []
    });

    expect(await readFile(outputPath, "utf8")).toBe("verified");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function _supportFixtureSource(value: string): string {
  return `export async function buildAgentProjectBundle(input) {
  await Bun.write(input.bundlePath, ${JSON.stringify(value)});
}\n`;
}
