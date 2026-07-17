import { lstat, readdir } from "node:fs/promises";
import path from "node:path";

import type { AgentProjectDiagnostic } from "../../shared/agent-project";

const DEFINITION_FILE = "agent.ts";
const INSTRUCTIONS_FILE = "instructions.md";

export interface AgentProjectSourceRef {
  readonly absolutePath: string;
  readonly logicalPath: string;
}

export interface DiscoveredAgentProject {
  readonly root: string;
  readonly definition?: AgentProjectSourceRef;
  readonly instructions?: AgentProjectSourceRef;
  readonly tools: readonly AgentProjectSourceRef[];
  readonly connections: readonly AgentProjectSourceRef[];
  readonly skillsRoot?: string;
  readonly diagnostics: readonly AgentProjectDiagnostic[];
}

export async function discoverAgentProject(
  agentRoot: string
): Promise<DiscoveredAgentProject> {
  const root = path.resolve(agentRoot);
  const diagnostics: AgentProjectDiagnostic[] = [];
  const definition = await _discoverRequiredFile({
    root,
    fileName: DEFINITION_FILE,
    missingCode: "definition_missing",
    invalidCode: "definition_import_failed",
    diagnostics
  });
  const instructions = await _discoverRequiredFile({
    root,
    fileName: INSTRUCTIONS_FILE,
    missingCode: "instructions_missing",
    invalidCode: "instructions_read_failed",
    diagnostics
  });
  const tools = await _discoverTools(root, diagnostics);
  const connections = await _discoverConnections(root, diagnostics);
  const skillsRootCandidate = path.join(root, "skills");
  let skillsRoot: string | undefined = skillsRootCandidate;
  try {
    if (await _isSymlink(skillsRootCandidate)) {
      diagnostics.push({
        severity: "error",
        code: "skill_invalid",
        message: "The skills source directory cannot be a symbolic link",
        path: skillsRootCandidate
      });
      skillsRoot = undefined;
    } else {
      for (const symlink of await _findSymlinks(skillsRootCandidate)) {
        diagnostics.push({
          severity: "error",
          code: "skill_invalid",
          message: "Symbolic links are not supported in Agent Project skills",
          path: symlink
        });
      }
    }
  } catch (error) {
    diagnostics.push({
      severity: "error",
      code: "skill_invalid",
      message: `Unable to load skills: ${_errorMessage(error)}`,
      path: skillsRootCandidate
    });
    skillsRoot = undefined;
  }

  return {
    root,
    definition,
    instructions,
    tools,
    connections,
    skillsRoot,
    diagnostics
  };
}

async function _discoverConnections(
  root: string,
  diagnostics: AgentProjectDiagnostic[]
): Promise<AgentProjectSourceRef[]> {
  const connectionsRoot = path.join(root, "connections");
  let entries;
  try {
    if (await _isSymlink(connectionsRoot)) {
      diagnostics.push({
        severity: "error",
        code: "connection_import_failed",
        message: "The connections source directory cannot be a symbolic link",
        path: connectionsRoot
      });
      return [];
    }
    entries = await readdir(connectionsRoot, { withFileTypes: true });
  } catch (error) {
    if (_hasCode(error, "ENOENT")) {
      return [];
    }
    diagnostics.push({
      severity: "error",
      code: "connection_import_failed",
      message: `Unable to list connections: ${_errorMessage(error)}`,
      path: connectionsRoot
    });
    return [];
  }
  const connections: AgentProjectSourceRef[] = [];
  for (const entry of entries.sort((left, right) => {
    if (left.name < right.name) {
      return -1;
    }
    if (left.name > right.name) {
      return 1;
    }
    return 0;
  })) {
    if (!entry.name.endsWith(".ts") && !entry.name.endsWith(".js")) {
      continue;
    }
    const absolutePath = path.join(connectionsRoot, entry.name);
    if (entry.isSymbolicLink() || !entry.isFile()) {
      diagnostics.push({
        severity: "error",
        code: "connection_import_failed",
        message: `Connection source must be a regular file: ${entry.name}`,
        path: absolutePath
      });
      continue;
    }
    connections.push({
      absolutePath,
      logicalPath: path.posix.join("connections", entry.name)
    });
  }
  return connections;
}

async function _discoverRequiredFile({
  root,
  fileName,
  missingCode,
  invalidCode,
  diagnostics
}: {
  diagnostics: AgentProjectDiagnostic[];
  fileName: string;
  invalidCode: "definition_import_failed" | "instructions_read_failed";
  missingCode: "definition_missing" | "instructions_missing";
  root: string;
}): Promise<AgentProjectSourceRef | undefined> {
  const absolutePath = path.join(root, fileName);
  try {
    const info = await lstat(absolutePath);
    if (info.isSymbolicLink()) {
      diagnostics.push({
        severity: "error",
        code: invalidCode,
        message: `${fileName} cannot be a symbolic link`,
        path: absolutePath
      });
      return undefined;
    }
    if (!info.isFile()) {
      diagnostics.push({
        severity: "error",
        code: invalidCode,
        message: `${fileName} must be a file`,
        path: absolutePath
      });
      return undefined;
    }
    return { absolutePath, logicalPath: fileName };
  } catch (error) {
    if (_hasCode(error, "ENOENT")) {
      diagnostics.push({
        severity: "error",
        code: missingCode,
        message: `Missing required ${fileName}`,
        path: absolutePath
      });
      return undefined;
    }
    diagnostics.push({
      severity: "error",
      code: invalidCode,
      message: `Unable to inspect ${fileName}: ${_errorMessage(error)}`,
      path: absolutePath
    });
    return undefined;
  }
}

async function _discoverTools(
  root: string,
  diagnostics: AgentProjectDiagnostic[]
): Promise<AgentProjectSourceRef[]> {
  const toolsRoot = path.join(root, "tools");
  let entries;
  try {
    if (await _isSymlink(toolsRoot)) {
      diagnostics.push({
        severity: "error",
        code: "tool_import_failed",
        message: "The tools source directory cannot be a symbolic link",
        path: toolsRoot
      });
      return [];
    }
    entries = await readdir(toolsRoot, { withFileTypes: true });
  } catch (error) {
    if (_hasCode(error, "ENOENT")) {
      return [];
    }
    diagnostics.push({
      severity: "error",
      code: "tool_import_failed",
      message: `Unable to list tools: ${_errorMessage(error)}`,
      path: toolsRoot
    });
    return [];
  }
  const tools: AgentProjectSourceRef[] = [];
  for (const entry of entries.sort((left, right) => {
    if (left.name < right.name) {
      return -1;
    }
    if (left.name > right.name) {
      return 1;
    }
    return 0;
  })) {
    if (!entry.name.endsWith(".ts") && !entry.name.endsWith(".js")) {
      continue;
    }
    const absolutePath = path.join(toolsRoot, entry.name);
    if (entry.isSymbolicLink()) {
      diagnostics.push({
        severity: "error",
        code: "tool_import_failed",
        message: `Symbolic-link tools are not supported: ${entry.name}`,
        path: absolutePath
      });
      continue;
    }
    if (!entry.isFile()) {
      diagnostics.push({
        severity: "error",
        code: "tool_import_failed",
        message: `Tool source must be a file: ${entry.name}`,
        path: absolutePath
      });
      continue;
    }
    tools.push({
      absolutePath,
      logicalPath: path.posix.join("tools", entry.name)
    });
  }
  return tools;
}

async function _isSymlink(candidate: string): Promise<boolean> {
  try {
    return (await lstat(candidate)).isSymbolicLink();
  } catch (error) {
    if (_hasCode(error, "ENOENT")) {
      return false;
    }
    throw error;
  }
}

async function _findSymlinks(root: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (_hasCode(error, "ENOENT")) {
      return [];
    }
    throw error;
  }
  const result: string[] = [];
  for (const entry of entries) {
    const absolutePath = path.join(root, entry.name);
    if (entry.isSymbolicLink()) {
      result.push(absolutePath);
    } else if (entry.isDirectory()) {
      result.push(...(await _findSymlinks(absolutePath)));
    }
  }
  return result;
}

function _hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

function _errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
