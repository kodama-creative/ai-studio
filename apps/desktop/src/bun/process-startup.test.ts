import { expect, test } from "bun:test";
import path from "node:path";

test("startup hydrates env and captures deep links before composition loads", async () => {
  const fixture = path.join(import.meta.dir, "process-startup-fixture.ts");
  const subprocess = Bun.spawn([process.execPath, fixture], {
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    subprocess.exited,
    new Response(subprocess.stdout).text(),
    new Response(subprocess.stderr).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(
      `Startup fixture failed with exit code ${exitCode}.\n${stdout}\n${stderr}`
    );
  }
  expect(exitCode).toBe(0);
});
