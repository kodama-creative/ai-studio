import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOTS: string[] = [];

afterEach(async () => {
  await Promise.all(
    ROOTS.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

test("basic agent CLI executes one local message", async () => {
  const home = await mkdtemp(join(tmpdir(), "llm-space-basic-agent-cli-"));
  ROOTS.push(home);
  const child = Bun.spawn(
    [process.execPath, "run.ts", "--message", "hello local agent"],
    {
      cwd: import.meta.dir,
      env: {
        ...process.env,
        LLM_SPACE_HOME: home,
        LLM_SPACE_MODEL: "faux/local",
      },
      stdout: "pipe",
      stderr: "pipe",
    }
  );
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);

  expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
  expect(stdout).toMatch(/^Session: session_[a-f0-9]+\n/);
  expect(stdout).toEndWith("The message contains 3 words.\n");
});

test("basic agent CLI exits after one interrupt at the interactive prompt", async () => {
  const home = await mkdtemp(join(tmpdir(), "llm-space-basic-agent-sigint-"));
  ROOTS.push(home);
  const child = Bun.spawn([process.execPath, "run.ts"], {
    cwd: import.meta.dir,
    env: {
      ...process.env,
      LLM_SPACE_HOME: home,
      LLM_SPACE_MODEL: "faux/local",
    },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  const reader = child.stdout.getReader();
  const decoder = new TextDecoder();
  let stdout = "";
  while (!stdout.includes("> ")) {
    const value = await reader.read();
    if (value.done) break;
    stdout += decoder.decode(value.value, { stream: true });
  }

  child.kill("SIGINT");
  const exitCode = await Promise.race([
    child.exited,
    new Promise<"timeout">((resolve) => {
      setTimeout(() => resolve("timeout"), 1_000);
    }),
  ]);
  if (exitCode === "timeout") child.kill("SIGKILL");
  const stderr = await new Response(child.stderr).text();

  expect(exitCode).toBe(130);
  expect(stderr).toBe("");
});
