import { readdir, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import { moduleBaseName } from "./module-files";
import {
  type AgentDiagnostic,
  type AgentProjectOptions,
  AgentProjectResolutionError,
  type ResolvedAgentProject,
} from "./types";

const PROJECT_MARKERS = new Set(["package.json", "vercel.json"]);
const FLAT_DIRECTORIES = new Set([
  "channels",
  "connections",
  "extensions",
  "hooks",
  "instructions",
  "sandbox",
  "schedules",
  "skills",
  "subagents",
  "tools",
]);

async function _kind(
  path: string
): Promise<"directory" | "file" | "other" | "missing"> {
  try {
    const value = await stat(path);
    if (value.isDirectory()) return "directory";
    if (value.isFile()) return "file";
    return "other";
  } catch {
    return "missing";
  }
}

async function _searchDirectory(path: string): Promise<string> {
  const resolved = resolve(path);
  return (await _kind(resolved)) === "directory" ? resolved : dirname(resolved);
}

async function _hasProjectMarker(path: string): Promise<boolean> {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    return entries.some(
      (entry) => entry.isFile() && PROJECT_MARKERS.has(entry.name)
    );
  } catch {
    return false;
  }
}

async function _isFlatAgentRoot(path: string): Promise<boolean> {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    return entries.some((entry) => {
      if (entry.isFile()) {
        const lower = entry.name.toLowerCase();
        return (
          lower === "instructions.md" ||
          lower === "system.md" ||
          moduleBaseName(entry.name) === "agent" ||
          moduleBaseName(entry.name) === "instructions" ||
          moduleBaseName(entry.name) === "system"
        );
      }
      return entry.isDirectory() && FLAT_DIRECTORIES.has(entry.name);
    });
  } catch {
    return false;
  }
}

export async function resolveAgentProject(
  options: AgentProjectOptions = {}
): Promise<ResolvedAgentProject> {
  const startDirectory = await _searchDirectory(
    options.startPath ?? process.cwd()
  );
  let currentDirectory = startDirectory;

  while (true) {
    if (basename(currentDirectory) === "agent") {
      const appRoot = dirname(currentDirectory);
      if (await _hasProjectMarker(appRoot)) {
        return { agentRoot: currentDirectory, appRoot, layout: "nested" };
      }
    }

    if (
      (await _hasProjectMarker(currentDirectory)) &&
      (await _kind(join(currentDirectory, "agent"))) === "directory"
    ) {
      return {
        agentRoot: join(currentDirectory, "agent"),
        appRoot: currentDirectory,
        layout: "nested",
      };
    }

    if (await _isFlatAgentRoot(currentDirectory)) {
      return {
        agentRoot: currentDirectory,
        appRoot: currentDirectory,
        layout: "flat",
      };
    }

    const parentDirectory = dirname(currentDirectory);
    if (parentDirectory === currentDirectory) break;
    currentDirectory = parentDirectory;
  }

  const diagnostic: AgentDiagnostic = {
    code: "discover/project-not-found",
    message: `Could not resolve an LLM Space agent root from "${startDirectory}".`,
    severity: "error",
    sourcePath: startDirectory,
  };
  throw new AgentProjectResolutionError(diagnostic);
}
