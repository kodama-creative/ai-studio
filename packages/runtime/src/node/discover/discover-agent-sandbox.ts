import { lstat, readdir } from "node:fs/promises";
import path from "node:path";

import { hasControlCharacter } from "../has-control-character";

import type {
  AgentProjectSourceRef
} from "./discover-agent-project";
import type { AgentProjectDiagnostic } from "../../shared/agent-project";

export const SANDBOX_WORKSPACE_MAX_FILES = 1_000;
export const SANDBOX_WORKSPACE_MAX_FILE_BYTES = 25 * 1024 * 1024;
export const SANDBOX_WORKSPACE_MAX_TOTAL_BYTES = 100 * 1024 * 1024;
export const SANDBOX_WORKSPACE_MAX_DEPTH = 20;
export const SANDBOX_WORKSPACE_MAX_PATH_BYTES = 240;

export interface DiscoveredAgentSandbox {
  readonly definition?: AgentProjectSourceRef;
  readonly workspace: readonly AgentProjectSourceRef[];
}

export async function discoverAgentSandbox(
  root: string,
  diagnostics: AgentProjectDiagnostic[]
): Promise<DiscoveredAgentSandbox | undefined> {
  const flatPath = path.join(root, "sandbox.ts");
  const directoryPath = path.join(root, "sandbox");
  const [flatInfo, directoryInfo] = await Promise.all([
    _lstat(flatPath),
    _lstat(directoryPath)
  ]);
  if (!flatInfo && !directoryInfo) { return undefined; }
  if (flatInfo && directoryInfo) {
    diagnostics.push({
      severity: "error",
      code: "sandbox_import_failed",
      message: "Use either sandbox.ts or sandbox/sandbox.ts, not both",
      path: directoryPath
    });
    return { workspace: [] };
  }
  if (flatInfo) {
    if (flatInfo.isSymbolicLink() || !flatInfo.isFile()) {
      diagnostics.push({
        severity: "error",
        code: "sandbox_import_failed",
        message: "sandbox.ts must be a regular non-symlink file",
        path: flatPath
      });
      return { workspace: [] };
    }
    return {
      definition: { absolutePath: flatPath, logicalPath: "sandbox.ts" },
      workspace: []
    };
  }
  if (!directoryInfo?.isDirectory() || directoryInfo.isSymbolicLink()) {
    diagnostics.push({
      severity: "error",
      code: "sandbox_import_failed",
      message: "sandbox must be a regular non-symlink directory",
      path: directoryPath
    });
    return { workspace: [] };
  }
  let entries;
  try {
    entries = await readdir(directoryPath, { withFileTypes: true });
  } catch (error) {
    diagnostics.push({
      severity: "error",
      code: "sandbox_import_failed",
      message: `Unable to list Sandbox source: ${_message(error)}`,
      path: directoryPath
    });
    return { workspace: [] };
  }
  for (const entry of entries) {
    if (entry.name !== "sandbox.ts" && entry.name !== "workspace") {
      diagnostics.push({
        severity: "error",
        code: "sandbox_import_failed",
        message: `Unsupported Sandbox source entry: ${entry.name}`,
        path: path.join(directoryPath, entry.name)
      });
    }
  }
  const definitionPath = path.join(directoryPath, "sandbox.ts");
  const definitionInfo = await _lstat(definitionPath);
  const definition = definitionInfo?.isFile()
    && !definitionInfo.isSymbolicLink()
    ? {
      absolutePath: definitionPath,
      logicalPath: "sandbox/sandbox.ts"
    }
    : undefined;
  if (!definition) {
    diagnostics.push({
      severity: "error",
      code: "sandbox_import_failed",
      message: "sandbox/sandbox.ts must be a regular non-symlink file",
      path: definitionPath
    });
  }
  const workspaceRoot = path.join(directoryPath, "workspace");
  const workspaceInfo = await _lstat(workspaceRoot);
  if (!workspaceInfo) {
    return { definition, workspace: [] };
  }
  if (workspaceInfo.isSymbolicLink() || !workspaceInfo.isDirectory()) {
    diagnostics.push({
      severity: "error",
      code: "sandbox_workspace_invalid",
      message: "sandbox/workspace must be a regular non-symlink directory",
      path: workspaceRoot
    });
    return { definition, workspace: [] };
  }
  const state = { files: 0, totalBytes: 0 };
  const workspace = await _discoverWorkspaceFiles(
    workspaceRoot,
    "",
    diagnostics,
    state
  );
  return { definition, workspace };
}

async function _discoverWorkspaceFiles(
  workspaceRoot: string,
  prefix: string,
  diagnostics: AgentProjectDiagnostic[],
  state: { files: number; totalBytes: number; }
): Promise<AgentProjectSourceRef[]> {
  let entries;
  try {
    entries = await readdir(path.join(workspaceRoot, prefix), {
      withFileTypes: true
    });
  } catch (error) {
    diagnostics.push({
      severity: "error",
      code: "sandbox_workspace_invalid",
      message: `Unable to list Sandbox workspace: ${_message(error)}`,
      path: path.join(workspaceRoot, prefix)
    });
    return [];
  }
  const files: AgentProjectSourceRef[] = [];
  for (const entry of entries.toSorted((left, right) =>
    (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))) {
    const relativePath = path.posix.join(prefix, entry.name);
    const absolutePath = path.join(workspaceRoot, ...relativePath.split("/"));
    if (!_validRelativePath(relativePath)) {
      diagnostics.push({
        severity: "error",
        code: "sandbox_workspace_invalid",
        message: `Invalid Sandbox workspace path: ${relativePath}`,
        path: absolutePath
      });
      continue;
    }
    if (entry.isSymbolicLink()) {
      diagnostics.push({
        severity: "error",
        code: "sandbox_workspace_invalid",
        message: `Sandbox workspace symlinks are not supported: ${relativePath}`,
        path: absolutePath
      });
      continue;
    }
    if (entry.isDirectory()) {
      files.push(...(await _discoverWorkspaceFiles(
        workspaceRoot,
        relativePath,
        diagnostics,
        state
      )));
      continue;
    }
    const info = await _lstat(absolutePath);
    if (!entry.isFile() || !info?.isFile()) {
      diagnostics.push({
        severity: "error",
        code: "sandbox_workspace_invalid",
        message: `Sandbox workspace entry must be a regular file: ${relativePath}`,
        path: absolutePath
      });
      continue;
    }
    state.files += 1;
    state.totalBytes += info.size;
    if (state.files > SANDBOX_WORKSPACE_MAX_FILES) {
      diagnostics.push({
        severity: "error",
        code: "sandbox_workspace_invalid",
        message: `Sandbox workspace supports at most ${SANDBOX_WORKSPACE_MAX_FILES} files`,
        path: absolutePath
      });
      continue;
    }
    if (info.size > SANDBOX_WORKSPACE_MAX_FILE_BYTES) {
      diagnostics.push({
        severity: "error",
        code: "sandbox_workspace_invalid",
        message: `Sandbox workspace file exceeds 25 MiB: ${relativePath}`,
        path: absolutePath
      });
      continue;
    }
    if (state.totalBytes > SANDBOX_WORKSPACE_MAX_TOTAL_BYTES) {
      diagnostics.push({
        severity: "error",
        code: "sandbox_workspace_invalid",
        message: "Sandbox workspace exceeds 100 MiB",
        path: absolutePath
      });
      continue;
    }
    files.push({
      absolutePath,
      logicalPath: path.posix.join("sandbox/workspace", relativePath)
    });
  }
  return files;
}

function _validRelativePath(value: string): boolean {
  const segments = value.split("/");
  return value.length > 0
    && !value.startsWith("/")
    && !value.includes("\\")
    && !hasControlCharacter(value)
    && segments.length <= SANDBOX_WORKSPACE_MAX_DEPTH
    && segments.every(segment => segment.length > 0
      && segment !== "."
      && segment !== "..")
    && new TextEncoder().encode(value).byteLength
    <= SANDBOX_WORKSPACE_MAX_PATH_BYTES;
}

async function _lstat(target: string) {
  try {
    return await lstat(target);
  } catch (error) {
    if (_hasCode(error, "ENOENT")) { return undefined; }
    throw error;
  }
}

function _hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

function _message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
