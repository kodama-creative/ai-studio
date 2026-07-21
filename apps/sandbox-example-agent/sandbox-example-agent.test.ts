import {
  loadAgentProject,
  loadAgentProjectManifest
} from "@llm-space/runtime/node";
import { describe, expect, test } from "bun:test";

describe("Sandbox example Agent Project", () => {
  test("loads the required workspace and canonical ExecutionEnv tools", async () => {
    const resolved = await loadAgentProjectManifest(import.meta.dir);
    const snapshot = await loadAgentProject(resolved.agentRoot);

    expect(snapshot.diagnostics).toEqual([]);
    expect(snapshot.definition).toEqual({
      model: { provider: "openai", id: "gpt-5.3-codex" },
      reasoning: "high"
    });
    expect(snapshot.sandbox).toMatchObject({
      sourcePath: "sandbox/sandbox.ts",
      workspace: [{
        path: "README.md",
        size: expect.any(Number),
        fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
        contentBase64: expect.any(String)
      }]
    });
    expect(snapshot.tools.map(tool => ({
      name: tool.name,
      kind: tool.executionEnvToolKind,
      required: tool.requiresExecutionEnv
    }))).toEqual([
      { name: "bash", kind: "bash", required: true },
      { name: "read", kind: "read", required: true },
      { name: "write", kind: "write", required: true }
    ]);
    expect(snapshot.artifact.fingerprints.capabilities.entries.map(entry =>
      entry.id)).toEqual([
      "agent",
      "instruction:instructions.md",
      "instructions",
      "sandbox",
      "tool:bash",
      "tool:read",
      "tool:write"
    ]);
  });
});
