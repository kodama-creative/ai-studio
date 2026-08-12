import type { SourceRevisionProvider } from "@llm-space/studio";

export class GitHeadProvider implements SourceRevisionProvider {
  constructor(private readonly _projectRoot: string) {}

  async current(): Promise<string> {
    const process = Bun.spawn(
      ["git", "-C", this._projectRoot, "rev-parse", "HEAD"],
      { stdout: "pipe", stderr: "pipe" }
    );
    const [exitCode, stdout, stderr] = await Promise.all([
      process.exited,
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
    ]);
    if (exitCode !== 0) {
      throw new Error(
        `Unable to read the Agent Project HEAD commit: ${stderr.trim() || `git exited with ${exitCode}`}`
      );
    }
    const commitId = stdout.trim();
    if (commitId.length === 0) {
      throw new Error("The Agent Project does not have a HEAD commit.");
    }
    return commitId;
  }

  /** Bind only a clean worktree; dirty experiments intentionally stay live. */
  async binding(): Promise<string | undefined> {
    const process = Bun.spawn(
      ["git", "-C", this._projectRoot, "status", "--porcelain"],
      { stdout: "pipe", stderr: "pipe" }
    );
    const [exitCode, stdout, stderr] = await Promise.all([
      process.exited,
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
    ]);
    if (exitCode !== 0) {
      throw new Error(
        `Unable to inspect the Agent Project worktree: ${stderr.trim() || `git exited with ${exitCode}`}`
      );
    }
    return stdout.trim().length === 0 ? this.current() : undefined;
  }
}
