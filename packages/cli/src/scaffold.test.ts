import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  loadAgentProjectManifest,
  loadAgentProject,
} from "@llm-space/runtime/node";
import { afterEach, describe, expect, test } from "bun:test";

import { scaffoldAgentProject } from "./scaffold";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true }))
  );
});

function _root() {
  const root = path.join(tmpdir(), `llm-space-cli-${crypto.randomUUID()}`);
  roots.push(root);
  return root;
}

describe("scaffoldAgentProject", () => {
  test("creates a runnable starter inside an existing directory", async () => {
    const root = _root();
    await mkdir(root);
    await writeFile(path.join(root, "README.md"), "keep\n", "utf8");
    await scaffoldAgentProject({ directory: root, template: "starter" });

    const resolved = await loadAgentProjectManifest(root);
    const snapshot = await loadAgentProject(resolved.agentRoot);
    expect(snapshot.diagnostics).toEqual([]);
    expect(snapshot.definition).toEqual({
      model: { provider: "openai", id: "gpt-5.3-codex" },
      reasoning: "high",
    });
    expect(snapshot.tools.map((tool) => tool.name)).toEqual(["get_weather"]);
    expect(snapshot.resources.skills?.map((skill) => skill.name)).toEqual([
      "weather-brief",
    ]);
    expect(await readFile(path.join(root, "README.md"), "utf8")).toBe("keep\n");
  });

  test("creates a valid blank project", async () => {
    const root = _root();
    await scaffoldAgentProject({ directory: root, template: "blank" });
    const resolved = await loadAgentProjectManifest(root);
    const snapshot = await loadAgentProject(resolved.agentRoot);
    expect(snapshot.diagnostics).toEqual([]);
    expect(snapshot.definition).toEqual({
      model: { provider: "openai", id: "gpt-5.3-codex" },
      reasoning: "high",
    });
    expect(snapshot.tools).toEqual([]);
  });

  test("refuses conflicts without leaving staging data", async () => {
    const root = _root();
    await mkdir(path.join(root, "agent"), { recursive: true });
    try {
      await scaffoldAgentProject({ directory: root, template: "starter" });
      throw new Error("Expected scaffold to reject the conflict.");
    } catch (error) {
      expect(String(error)).toContain("Refusing to overwrite");
    }
    expect((await readdir(root)).sort()).toEqual(["agent"]);
  });
});
