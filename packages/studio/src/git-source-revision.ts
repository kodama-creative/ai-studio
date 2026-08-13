/** Git-backed revision used for informational Project source display. */
export class GitSourceRevision {
  constructor(private readonly _projectRoot: string) {}

  current(): Promise<string> {
    return this._git(["rev-parse", "HEAD"], "read the Agent Project HEAD");
  }

  private async _git(args: readonly string[], action: string): Promise<string> {
    const process = Bun.spawn(["git", "-C", this._projectRoot, ...args], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      process.exited,
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
    ]);
    if (exitCode !== 0) {
      throw new Error(
        `Unable to ${action}: ${stderr.trim() || `git exited with ${exitCode}`}`
      );
    }
    const value = stdout.trim();
    if (args[0] === "rev-parse" && value.length === 0) {
      throw new Error("The Agent Project does not have a HEAD commit.");
    }
    return value;
  }
}
