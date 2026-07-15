import { mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "bun:test";

import { loadAgentProjectManifest } from "./manifest";

const ROOTS: string[] = [];

afterEach(async () => {
  await Promise.all(
    ROOTS.splice(0).map(async root => rm(root, { recursive: true }))
  );
});

async function _fixture(agent = "./agent") {
  const root = path.join(tmpdir(), `llm-space-manifest-${crypto.randomUUID()}`);
  ROOTS.push(root);
  await mkdir(path.join(root, "agent"), { recursive: true });
  await writeFile(
    path.join(root, "llm-space.json"),
    JSON.stringify({ schemaVersion: 1, agent }),
    "utf8"
  );
  return root;
}

describe("loadAgentProjectManifest", () => {
  test("defaults a manifestless project to the agent directory", async () => {
    const root = path.join(
      tmpdir(),
      `llm-space-manifest-${crypto.randomUUID()}`
    );
    ROOTS.push(root);
    await mkdir(path.join(root, "agent"), { recursive: true });

    const loaded = await loadAgentProjectManifest(root);
    const canonical = await realpath(root);
    expect(loaded.projectRoot).toBe(canonical);
    expect(loaded.agentRoot).toBe(path.join(canonical, "agent"));
    expect(loaded.manifest).toEqual({ schemaVersion: 1, agent: "agent" });
  });

  test("resolves a confined Agent root", async () => {
    const root = await _fixture();
    const loaded = await loadAgentProjectManifest(root);
    const canonical = await realpath(root);
    expect(loaded.projectRoot).toBe(canonical);
    expect(loaded.agentRoot).toBe(path.join(canonical, "agent"));
  });

  test("rejects traversal and source-root symlinks", async () => {
    const traversal = await _fixture("../agent");
    try {
      await loadAgentProjectManifest(traversal);
      throw new Error("Expected traversal to be rejected.");
    } catch (error) {
      expect(String(error)).toContain("escapes the project root");
    }

    const linked = await _fixture("./linked");
    await symlink(path.join(linked, "agent"), path.join(linked, "linked"));
    try {
      await loadAgentProjectManifest(linked);
      throw new Error("Expected source-root symlink to be rejected.");
    } catch (error) {
      expect(String(error)).toContain("cannot be a symbolic link");
    }
  });
});
