import { expect, test } from "bun:test";
import path from "node:path";

test("bootstrap preserves startup ordering and cleans a failed process scope", async () => {
  const fixture = path.join(import.meta.dir, "bootstrap-fixture.ts");
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
      `Bootstrap fixture failed with exit code ${exitCode}.\n${stdout}\n${stderr}`
    );
  }
  expect(exitCode).toBe(0);
});
