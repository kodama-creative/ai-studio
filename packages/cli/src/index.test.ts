import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";

const ROOTS: string[] = [];

afterEach(async () => {
  await Promise.all(ROOTS.splice(0).map(async root => rm(root, { recursive: true })));
});

describe("llm-space build", () => {
  test("creates an OCI context from an Agent Project directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "llm-space-cli-build-"));
    ROOTS.push(root);
    const output = join(root, "oci");
    const result = await _cli([
      "build",
      join(import.meta.dir, "../../../apps/example-agent"),
      "--target",
      "oci",
      "--output",
      output
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Created OCI build context");
    expect(await readdir(output)).toContain("Containerfile");
  });

  test("rejects an incomplete build contract without writing output", async () => {
    const result = await _cli(["build", "--target", "oci"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--output is required");
  });
});

async function _cli(args: readonly string[]): Promise<{
  exitCode: number;
  stderr: string;
  stdout: string;
}> {
  const child = Bun.spawn([
    process.execPath,
    join(import.meta.dir, "index.ts"),
    ...args
  ], { stdout: "pipe", stderr: "pipe" });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text()
  ]);
  return { exitCode, stdout, stderr };
}
