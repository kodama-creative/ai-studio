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

describe("llm-space init", () => {
  test("creates the default canonical preset combination", async () => {
    const parent = await mkdtemp(join(tmpdir(), "llm-space-cli-init-"));
    ROOTS.push(parent);
    const project = join(parent, "my-agent");
    const result = await _cli(["init", project]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(project);
    expect((await readdir(join(project, "agent"))).sort()).toEqual([
      "agent.ts",
      "instructions.md",
      "skills",
      "tools"
    ]);
  });

  test("supports blank and explicit MCP presets without interactive input", async () => {
    const parent = await mkdtemp(join(tmpdir(), "llm-space-cli-init-"));
    ROOTS.push(parent);
    const blank = join(parent, "blank-agent");
    const remote = join(parent, "remote-agent");
    expect((await _cli(["init", blank, "--blank"])).exitCode).toBe(0);
    expect((await readdir(join(blank, "agent"))).sort()).toEqual([
      "agent.ts",
      "instructions.md"
    ]);

    const result = await _cli([
      "init",
      remote,
      "--preset",
      "mcp-connection",
      "--mcp-url",
      "https://mcp.example.test/tools",
      "--mcp-tool",
      "remote_echo"
    ]);
    expect(result.exitCode).toBe(0);
    expect(await readdir(join(remote, "agent", "connections"))).toEqual([
      "remote.ts"
    ]);
  });

  test("requires a new directory and complete non-conflicting options", async () => {
    const noDirectory = await _cli(["init"]);
    expect(noDirectory.exitCode).toBe(1);
    expect(noDirectory.stderr).toContain("Exactly one");

    const conflict = await _cli([
      "init",
      "agent",
      "--blank",
      "--preset",
      "skill"
    ]);
    expect(conflict.exitCode).toBe(1);
    expect(conflict.stderr).toContain("cannot be combined");

    const incompleteMcp = await _cli([
      "init",
      "agent",
      "--preset",
      "mcp-connection"
    ]);
    expect(incompleteMcp.exitCode).toBe(1);
    expect(incompleteMcp.stderr).toContain("requires --mcp-url");
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
