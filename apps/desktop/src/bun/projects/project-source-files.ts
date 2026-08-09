import {
  readFile,
  readdir,
  realpath,
  stat,
  watch as watchFiles,
} from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

import type { ProjectSourceNode } from "../../shared/project-studio";

const HIDDEN_NAMES = new Set([
  ".git",
  ".llm-space",
  ".next",
  ".turbo",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "threads",
]);
const MAX_SOURCE_FILE_BYTES = 2 * 1024 * 1024;

export class ProjectSourceFiles {
  constructor(private readonly _root: string) {}

  async list(): Promise<readonly ProjectSourceNode[]> {
    return this._listDirectory(await realpath(this._root), "");
  }

  async read(path: string): Promise<string> {
    const root = await realpath(this._root);
    const candidate = resolve(root, path);
    _assertWithinRoot(root, candidate);
    let canonical: string;
    try {
      canonical = await realpath(candidate);
    } catch (cause) {
      throw new Error(`Project source file "${path}" was not found.`, {
        cause,
      });
    }
    _assertWithinRoot(root, canonical);
    const file = await stat(canonical);
    if (!file.isFile())
      throw new Error(`Project source path "${path}" is not a file.`);
    if (file.size > MAX_SOURCE_FILE_BYTES) {
      throw new Error(`Project source file "${path}" is too large to display.`);
    }
    return readFile(canonical, "utf8");
  }

  async *watch(
    input: {
      readonly signal?: AbortSignal;
    } = {}
  ): AsyncIterable<readonly ProjectSourceNode[]> {
    const root = await realpath(this._root);
    const events = watchFiles(root, {
      recursive: true,
      signal: input.signal,
    });
    yield await this.list();
    try {
      for await (const event of events) {
        if (_ignoreWatchEvent(event.filename)) continue;
        yield await this.list();
      }
    } catch (error) {
      if (input.signal?.aborted || _isAbortError(error)) return;
      throw error;
    }
  }

  private async _listDirectory(
    absolutePath: string,
    relativePath: string
  ): Promise<ProjectSourceNode[]> {
    const entries = (await readdir(absolutePath, { withFileTypes: true }))
      .filter((entry) => !HIDDEN_NAMES.has(entry.name))
      .filter((entry) => entry.isDirectory() || entry.isFile())
      .toSorted((left, right) => left.name.localeCompare(right.name));
    return Promise.all(
      entries.map(async (entry): Promise<ProjectSourceNode> => {
        const path = relativePath
          ? `${relativePath}/${entry.name}`
          : entry.name;
        if (entry.isFile()) return { name: entry.name, path, type: "file" };
        return {
          name: entry.name,
          path,
          type: "directory",
          children: await this._listDirectory(
            resolve(absolutePath, entry.name),
            path
          ),
        };
      })
    );
  }
}

function _ignoreWatchEvent(filename: string | null): boolean {
  if (filename === null) return false;
  const first = filename.split(/[\\/]/u)[0];
  return first !== ".git" && first !== undefined && HIDDEN_NAMES.has(first);
}

function _isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AbortError"
  );
}

function _assertWithinRoot(root: string, candidate: string): void {
  const path = relative(root, candidate);
  if (path === "" || (!path.startsWith(`..${sep}`) && path !== "..")) return;
  throw new Error(
    `Project source path "${candidate}" is outside the Agent Project.`
  );
}
