import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

import type { SandboxService } from "@llm-space/agent/runtime";
import type {
  SandboxCommandResult,
  SandboxRunOptions,
  SandboxSession,
} from "@llm-space/agent/sandbox";

/** Local sandbox adapter whose filesystem and default cwd are one project. */
export class ProjectSandbox implements SandboxSession, SandboxService {
  constructor(private readonly _rootPath: string) {}

  /** Studio deliberately exposes the checked-out Project as its debug sandbox. */
  getOrCreate(): Promise<SandboxSession> {
    return Promise.resolve(this);
  }

  async run(
    command: string,
    options: SandboxRunOptions = {}
  ): Promise<SandboxCommandResult> {
    const cwd = this._path(options.cwd ?? ".");
    const child = Bun.spawn([process.env.SHELL || "/bin/sh", "-lc", command], {
      cwd,
      env: { ...process.env, ...options.env },
      signal: options.signal,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    return { exitCode, stdout, stderr };
  }

  async readFile(path: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(this._path(path)));
  }

  async writeFile(path: string, data: string | Uint8Array): Promise<void> {
    const destination = this._path(path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, data);
  }

  private _path(path: string): string {
    const destination = isAbsolute(path)
      ? resolve(path)
      : resolve(this._rootPath, path);
    const fromRoot = relative(this._rootPath, destination);
    if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`)) {
      throw new Error(`Project sandbox path escapes its root: ${path}`);
    }
    return destination;
  }
}
