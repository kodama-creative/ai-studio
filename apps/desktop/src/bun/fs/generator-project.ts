import { spawn } from "node:child_process";
import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { expandHomePath } from "@llm-space/core/server";

/**
 * Filesystem/exec backing for the code Generator, deliberately kept OUTSIDE the
 * root-confined generator filesystem: a generated project is written into a
 * user-picked directory anywhere on disk. Two guards keep this narrow:
 *
 * 1. Only directories the user explicitly picked via the native dialog
 *    (`authorizeDir`) can be written to / run in.
 * 2. The only command that can be spawned is `uv` — never an arbitrary command.
 */

/** Files `uv init` may drop that don't count against the "empty dir" gate. */
const _IGNORED_ENTRIES = new Set([".DS_Store", ".git", ".idea", ".vscode"]);

const OPEN_DEV_TERMINAL_SCRIPT = `on run argv
  set projectDir to item 1 of argv
  tell application "Terminal"
    activate
    do script "cd " & quoted form of projectDir & " && make dev"
  end tell
end run`;

/** Process-owned access boundary for directories selected by the Generator. */
export class GeneratorProjectWorkspace {
  private readonly _authorized = new Set<string>();

  /** Record a user-confirmed directory for writes and subprocess execution. */
  authorize(dir: string): void {
    this._authorized.add(path.resolve(dir));
  }

  /** Resolve, validate, create, and authorize a fresh generated project root. */
  async prepare(
    parentDir: string,
    projectName: string
  ): Promise<{ ok: true; dir: string } | { ok: false; error: string }> {
    const name = projectName.trim();
    if (!name) {
      return { ok: false, error: "Enter a project name." };
    }
    if (name === "." || name === ".." || /[/\\]/.test(name)) {
      return {
        ok: false,
        error: "Project name can't contain path separators.",
      };
    }
    const parent = path.resolve(expandHomePath(parentDir.trim() || "~"));
    const target = path.join(parent, name);
    try {
      const parentStat = await stat(parent);
      if (!parentStat.isDirectory()) {
        return { ok: false, error: `${parent} is not a directory.` };
      }
    } catch {
      return { ok: false, error: `Parent directory doesn't exist: ${parent}` };
    }
    try {
      const targetStat = await stat(target).catch(() => null);
      if (targetStat) {
        if (!targetStat.isDirectory()) {
          return { ok: false, error: `${target} already exists as a file.` };
        }
        if (!(await _isGeneratorDirEmpty(target))) {
          return {
            ok: false,
            error: `${name} already exists and isn't empty. Pick another name.`,
          };
        }
      }
      await mkdir(target, { recursive: true });
    } catch (error) {
      return {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not create the directory.",
      };
    }
    this.authorize(target);
    return { ok: true, dir: target };
  }

  /** Run only `uv` in an explicitly authorized generated project. */
  async runUv(
    rootDir: string,
    args: string[],
    opts?: { timeoutMs?: number }
  ): Promise<{
    code: number;
    stdout: string;
    stderr: string;
    timedOut: boolean;
  }> {
    const resolved = this._assertAuthorized(rootDir);
    const proc = Bun.spawn(["uv", ...args], {
      cwd: resolved,
      stdout: "pipe",
      stderr: "pipe",
      env: process.env,
    });
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (opts?.timeoutMs && opts.timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        proc.kill();
      }, opts.timeoutMs);
    }
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const code = await proc.exited;
    if (timer) clearTimeout(timer);
    return { code, stdout, stderr, timedOut };
  }

  /** Write UTF-8 content below an authorized root; traversal is rejected. */
  async writeFile(
    rootDir: string,
    relativePath: string,
    contents: string
  ): Promise<void> {
    const target = this._resolveInRoot(rootDir, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, contents, "utf8");
  }

  /** Delete one file below an authorized root; missing files are ignored. */
  async removeFile(rootDir: string, relativePath: string): Promise<void> {
    const target = this._resolveInRoot(rootDir, relativePath);
    await rm(target, { force: true });
  }

  /** Open Terminal in an authorized project; unsupported platforms return false. */
  async openDevTerminal(
    rootDir: string,
    dependencies: {
      platform?: NodeJS.Platform;
      runAppleScript?: (script: string, args: string[]) => Promise<void>;
    } = {}
  ): Promise<boolean> {
    if ((dependencies.platform ?? process.platform) !== "darwin") return false;
    const resolved = this._assertAuthorized(rootDir);
    await (dependencies.runAppleScript ?? _runAppleScript)(
      OPEN_DEV_TERMINAL_SCRIPT,
      [resolved]
    );
    return true;
  }

  private _assertAuthorized(rootDir: string): string {
    const resolved = path.resolve(rootDir);
    if (!this._authorized.has(resolved)) {
      throw new Error("Directory is not authorized for project generation.");
    }
    return resolved;
  }

  private _resolveInRoot(rootDir: string, relativePath: string): string {
    const resolved = this._assertAuthorized(rootDir);
    const target = path.resolve(resolved, relativePath);
    const rel = path.relative(resolved, target);
    if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new Error("Path escapes the project root.");
    }
    return target;
  }
}

/** Whether `uv` is on PATH, and its version when detectable. */
export async function checkUv(): Promise<{
  installed: boolean;
  version?: string;
}> {
  try {
    const proc = Bun.spawn(["uv", "--version"], {
      stdout: "pipe",
      stderr: "ignore",
      env: process.env,
    });
    const output = await new Response(proc.stdout).text();
    const code = await proc.exited;
    if (code !== 0) return { installed: false };
    return { installed: true, version: output.trim() || undefined };
  } catch {
    return { installed: false };
  }
}

/** Whether a directory contains only ignorable editor or OS metadata. */
async function _isGeneratorDirEmpty(dir: string): Promise<boolean> {
  try {
    const entries = await readdir(dir);
    return entries.every((entry) => _IGNORED_ENTRIES.has(entry));
  } catch {
    return true;
  }
}

function _runAppleScript(script: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("osascript", ["-e", script, ...args], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          stderr.trim() || `Failed to open Terminal (osascript exit ${code}).`
        )
      );
    });
  });
}
