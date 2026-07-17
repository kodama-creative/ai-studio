import { mkdir, readdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "bun:test";

import { scaffoldAgentProject } from "./scaffold-agent-project";

const ROOTS: string[] = [];

afterEach(async () => {
  await Promise.all(
    ROOTS.splice(0).map(async root => rm(root, { recursive: true, force: true }))
  );
});

function _parent(): string {
  const root = path.join(tmpdir(), `llm-space-scaffold-${crypto.randomUUID()}`);
  ROOTS.push(root);
  return root;
}

describe("scaffoldAgentProject", () => {
  test("publishes one complete project and refuses every existing target", async () => {
    const parent = _parent();
    await mkdir(parent);
    const target = path.join(parent, "my-agent");
    const created = await scaffoldAgentProject({
      directory: target,
      presets: ["skill", "local-tool"]
    });
    expect(created).toEqual({
      directory: path.join(await realpath(parent), "my-agent"),
      presets: ["local-tool", "skill"]
    });
    expect((await readdir(target)).sort()).toEqual(["agent", "llm-space.json"]);
    const overwrite = scaffoldAgentProject({
      directory: target,
      presets: []
    });
    expect(await _rejection(overwrite)).toContain("Refusing to overwrite");
    expect((await readdir(parent)).filter(name =>
      name.startsWith(".llm-space-scaffold-"))).toEqual([]);
  });

  test("allows only canonical names, presets, and explicit safe MCP input", async () => {
    const parent = _parent();
    await mkdir(parent);
    const invalidName = scaffoldAgentProject({
      directory: path.join(parent, "Bad Name"),
      presets: []
    });
    expect(await _rejection(invalidName)).toContain("lowercase kebab-case");
    const duplicatePreset = scaffoldAgentProject({
      directory: path.join(parent, "duplicate"),
      presets: ["skill", "skill"]
    });
    expect(await _rejection(duplicatePreset)).toContain("Duplicate");
    const missingMcp = scaffoldAgentProject({
      directory: path.join(parent, "missing-mcp"),
      presets: ["mcp-connection"]
    });
    expect(await _rejection(missingMcp)).toContain(
      "requires MCP connection settings"
    );
    const credentialUrl = scaffoldAgentProject({
      directory: path.join(parent, "credential-url"),
      presets: ["mcp-connection"],
      mcpConnection: {
        url: "https://secret@example.test/mcp",
        tools: ["echo"]
      }
    });
    expect(await _rejection(credentialUrl)).toContain("cannot contain credentials");
    const duplicateTools = scaffoldAgentProject({
      directory: path.join(parent, "duplicate-tools"),
      presets: ["mcp-connection"],
      mcpConnection: {
        url: "https://example.test/mcp",
        tools: ["echo", "echo"]
      }
    });
    expect(await _rejection(duplicateTools)).toContain("duplicate names");
    expect(await readdir(parent)).toEqual([]);
  });

  test("lets only one concurrent publisher win without staging residue", async () => {
    const parent = _parent();
    await mkdir(parent);
    const directory = path.join(parent, "race-agent");
    const results = await Promise.allSettled([
      scaffoldAgentProject({ directory, presets: ["local-tool"] }),
      scaffoldAgentProject({ directory, presets: ["skill"] })
    ]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
    expect((await readdir(parent)).filter(name =>
      name.startsWith(".llm-space-scaffold-"))).toEqual([]);
    expect(await readdir(directory)).toContain("llm-space.json");
  });
});

async function _rejection(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("Expected operation to reject.");
}
