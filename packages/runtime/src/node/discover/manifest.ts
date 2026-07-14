import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";

import {
  AGENT_PROJECT_MANIFEST_FILE,
  AGENT_PROJECT_MANIFEST_VERSION,
  AgentProjectManifestError,
  parseAgentProjectManifest,
  type AgentProjectManifest,
} from "../../shared/agent-project-manifest";

export interface ResolvedAgentProjectManifest {
  projectRoot: string;
  agentRoot: string;
  manifest: AgentProjectManifest;
}

/**
 * Read and safely resolve a portable Agent Project manifest without importing
 * authored tool modules. Hosts can use this before asking the user to trust a
 * project directory.
 */
export async function loadAgentProjectManifest(
  projectDirectory: string
): Promise<ResolvedAgentProjectManifest> {
  const projectRoot = await _canonicalDirectory(projectDirectory, "Project");
  const manifestPath = path.join(projectRoot, AGENT_PROJECT_MANIFEST_FILE);
  let manifest: AgentProjectManifest;
  try {
    manifest = parseAgentProjectManifest(
      JSON.parse(await readFile(manifestPath, "utf8")) as unknown
    );
  } catch (error) {
    if (_hasCode(error, "ENOENT")) {
      manifest = {
        schemaVersion: AGENT_PROJECT_MANIFEST_VERSION,
        agent: "agent",
      };
    } else if (error instanceof SyntaxError) {
      throw new AgentProjectManifestError(
        `${AGENT_PROJECT_MANIFEST_FILE} contains invalid JSON: ${error.message}`
      );
    } else if (error instanceof AgentProjectManifestError) {
      throw error;
    } else {
      throw new AgentProjectManifestError(
        `Unable to read ${AGENT_PROJECT_MANIFEST_FILE}: ${_message(error)}`
      );
    }
  }
  if (path.isAbsolute(manifest.agent)) {
    throw new AgentProjectManifestError(
      "The agent path must be relative to the project root."
    );
  }
  const candidate = path.resolve(projectRoot, manifest.agent);
  if (!_within(projectRoot, candidate)) {
    throw new AgentProjectManifestError(
      "The agent path escapes the project root."
    );
  }
  let agentRoot: string;
  try {
    const info = await lstat(candidate);
    if (info.isSymbolicLink()) {
      throw new AgentProjectManifestError(
        "The Agent source root cannot be a symbolic link."
      );
    }
    if (!info.isDirectory()) {
      throw new AgentProjectManifestError(
        "The configured Agent source path is not a directory."
      );
    }
    agentRoot = await realpath(candidate);
  } catch (error) {
    if (error instanceof AgentProjectManifestError) throw error;
    if (_hasCode(error, "ENOENT")) {
      throw new AgentProjectManifestError(
        `The configured Agent source directory does not exist: ${manifest.agent}`
      );
    }
    throw new AgentProjectManifestError(
      `Unable to resolve the Agent source directory: ${_message(error)}`
    );
  }
  if (!_within(projectRoot, agentRoot)) {
    throw new AgentProjectManifestError(
      "The resolved Agent source path escapes the project root."
    );
  }
  return { projectRoot, agentRoot, manifest };
}

async function _canonicalDirectory(input: string, label: string) {
  const resolved = path.resolve(input);
  try {
    const info = await lstat(resolved);
    if (info.isSymbolicLink()) {
      throw new AgentProjectManifestError(
        `${label} root cannot be a symbolic link.`
      );
    }
    if (!info.isDirectory()) {
      throw new AgentProjectManifestError(`${label} root is not a directory.`);
    }
    return await realpath(resolved);
  } catch (error) {
    if (error instanceof AgentProjectManifestError) throw error;
    throw new AgentProjectManifestError(
      `Unable to open ${label.toLowerCase()} root: ${_message(error)}`
    );
  }
}

function _within(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(root + path.sep);
}

function _hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

function _message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
