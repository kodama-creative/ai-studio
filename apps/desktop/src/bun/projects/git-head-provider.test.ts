import { expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { GitHeadProvider } from "./git-head-provider";

const exec = promisify(execFile);

test("GitHeadProvider reports HEAD and deliberately ignores dirty files", async () => {
  const root = await mkdtemp(join(tmpdir(), "llm-space-git-head-"));
  try {
    await exec("git", ["init", root]);
    await exec("git", ["-C", root, "config", "user.email", "test@example.com"]);
    await exec("git", ["-C", root, "config", "user.name", "Test"]);
    await writeFile(join(root, "agent.ts"), "export default 1;\n");
    await exec("git", ["-C", root, "add", "agent.ts"]);
    await exec("git", ["-C", root, "commit", "-m", "initial"]);
    const expected = (
      await exec("git", ["-C", root, "rev-parse", "HEAD"])
    ).stdout.trim();

    await writeFile(join(root, "agent.ts"), "export default 2;\n");

    expect(await new GitHeadProvider(root).current()).toBe(expected);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
