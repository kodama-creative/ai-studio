import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";

import { loadAgentProject } from "../../../src/node/compiler/load-agent-project";

const ROOTS: string[] = [];

afterEach(async () => {
  await Promise.all(
    ROOTS.splice(0).map(async root => rm(root, { recursive: true }))
  );
});

describe("loadAgentProject Agent limits", () => {
  test("compiles and fingerprints source-owned limits", async () => {
    const root = await _fixture();
    await writeFile(join(root, "agent.ts"), `
      import { defineAgent } from "@llm-space/runtime";
      export default defineAgent({
        model: "fake/model",
        limits: {
          maxInputTokensPerSession: 200000,
          maxOutputTokensPerSession: false
        }
      });
    `);
    const snapshot = await loadAgentProject(root);

    expect(snapshot.definition?.limits).toEqual({
      maxInputTokensPerSession: 200_000,
      maxModelCallsPerRun: 25,
      maxOutputTokensPerSession: false
    });
    expect(Object.isFrozen(snapshot.definition?.limits)).toBe(true);
    const limitedAgent = snapshot.artifact.fingerprints.capabilities.entries.find(
      entry => entry.id === "agent"
    );
    await writeFile(join(root, "agent.ts"), `
      import { defineAgent } from "@llm-space/runtime";
      export default defineAgent({ model: "fake/model" });
    `);
    const uncapped = await loadAgentProject(root);
    expect(uncapped.definition?.limits).toEqual({ maxModelCallsPerRun: 25 });
    const uncappedAgent = uncapped.artifact.fingerprints.capabilities.entries
      .find(entry => entry.id === "agent");
    expect(limitedAgent?.fingerprint).not.toBe(uncappedAgent?.fingerprint);
  });

  test("rejects invalid source declarations", async () => {
    for (const value of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      const root = await _fixture();
      await writeFile(join(root, "agent.ts"), `
        import { defineAgent } from "@llm-space/runtime";
        export default defineAgent({
          model: "fake/model",
          limits: { maxInputTokensPerSession: ${String(value)} }
        });
      `);
      const snapshot = await loadAgentProject(root);
      expect(snapshot.definition).toBeUndefined();
      expect(snapshot.diagnostics.some(diagnostic =>
        diagnostic.severity === "error")).toBe(true);
    }
  });

  test("preserves explicit model-call limits and the uncapped opt-out", async () => {
    const root = await _fixture();
    await writeFile(join(root, "agent.ts"), `
      import { defineAgent } from "@llm-space/runtime";
      export default defineAgent({
        model: "fake/model",
        limits: { maxModelCallsPerRun: false }
      });
    `);
    expect((await loadAgentProject(root)).definition?.limits).toEqual({
      maxModelCallsPerRun: false
    });

    await writeFile(join(root, "agent.ts"), `
      import { defineAgent } from "@llm-space/runtime";
      export default defineAgent({
        model: "fake/model",
        limits: { maxModelCallsPerRun: 7 }
      });
    `);
    expect((await loadAgentProject(root)).definition?.limits).toEqual({
      maxModelCallsPerRun: 7
    });
  });

  test("rejects invalid model-call limits", async () => {
    for (const value of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      const root = await _fixture();
      await writeFile(join(root, "agent.ts"), `
        import { defineAgent } from "@llm-space/runtime";
        export default defineAgent({
          model: "fake/model",
          limits: { maxModelCallsPerRun: ${String(value)} }
        });
      `);
      const snapshot = await loadAgentProject(root);
      expect(snapshot.definition).toBeUndefined();
      expect(snapshot.diagnostics.some(diagnostic =>
        diagnostic.severity === "error")).toBe(true);
    }
  });
});

async function _fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "llm-space-runtime-budget-"));
  ROOTS.push(root);
  await writeFile(join(root, "instructions.md"), "Test.\n");
  return root;
}
