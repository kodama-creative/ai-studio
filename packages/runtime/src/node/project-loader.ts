import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  loadSkills,
  NodeExecutionEnv,
  type AgentTool,
} from "@earendil-works/pi-agent-core/node";

import type { AgentProjectDiagnostic, AgentProjectSnapshot } from "../project";

const INSTRUCTIONS_FILE = "instructions.md";

export async function loadAgentProject(
  agentRoot: string
): Promise<AgentProjectSnapshot> {
  const root = resolve(agentRoot);
  const diagnostics: AgentProjectDiagnostic[] = [];
  const hash = createHash("sha256");
  const instructions = await _loadInstructions(root, diagnostics, hash);
  const tools = await _loadTools(root, diagnostics, hash);
  const env = new NodeExecutionEnv({ cwd: root });
  const skillsRoot = join(root, "skills");
  let skills: Awaited<ReturnType<typeof loadSkills>>["skills"] = [];
  try {
    if (await _isSymlink(skillsRoot)) {
      diagnostics.push({
        severity: "error",
        code: "skill_invalid",
        message: "The skills source directory cannot be a symbolic link",
        path: skillsRoot,
      });
    } else {
      for (const symlink of await _findSymlinks(skillsRoot)) {
        diagnostics.push({
          severity: "error",
          code: "skill_invalid",
          message: "Symbolic links are not supported in Agent Project skills",
          path: symlink,
        });
      }
      const loadedSkills = await loadSkills(env, skillsRoot);
      skills = loadedSkills.skills;
      for (const diagnostic of loadedSkills.diagnostics) {
        diagnostics.push({
          severity: "error",
          code: "skill_invalid",
          message: diagnostic.message,
          path: diagnostic.path,
        });
      }
    }
  } catch (error) {
    diagnostics.push({
      severity: "error",
      code: "skill_invalid",
      message: `Unable to load skills: ${_errorMessage(error)}`,
      path: skillsRoot,
    });
  } finally {
    await env.cleanup();
  }
  for (const skill of skills) {
    hash.update(skill.filePath);
    hash.update(skill.content);
  }
  return {
    root,
    instructions,
    tools,
    resources: { skills },
    diagnostics,
    fingerprint: hash.digest("hex"),
  };
}

async function _loadInstructions(
  root: string,
  diagnostics: AgentProjectDiagnostic[],
  hash: ReturnType<typeof createHash>
): Promise<string> {
  const path = join(root, INSTRUCTIONS_FILE);
  try {
    if ((await lstat(path)).isSymbolicLink()) {
      throw new Error(`${INSTRUCTIONS_FILE} cannot be a symbolic link`);
    }
    const instructions = await readFile(path, "utf8");
    hash.update(path);
    hash.update(instructions);
    return instructions;
  } catch (error) {
    const missing =
      error instanceof Error && "code" in error && error.code === "ENOENT";
    diagnostics.push({
      severity: "error",
      code: missing ? "instructions_missing" : "instructions_read_failed",
      message: missing
        ? `Missing required ${INSTRUCTIONS_FILE}`
        : `Unable to read ${INSTRUCTIONS_FILE}: ${_errorMessage(error)}`,
      path,
    });
    return "";
  }
}

async function _loadTools(
  root: string,
  diagnostics: AgentProjectDiagnostic[],
  hash: ReturnType<typeof createHash>
): Promise<AgentTool[]> {
  const toolsRoot = join(root, "tools");
  let entries: string[];
  try {
    if (await _isSymlink(toolsRoot)) {
      diagnostics.push({
        severity: "error",
        code: "tool_import_failed",
        message: "The tools source directory cannot be a symbolic link",
        path: toolsRoot,
      });
      return [];
    }
    entries = (await readdir(toolsRoot))
      .filter((entry) => entry.endsWith(".ts") || entry.endsWith(".js"))
      .sort();
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }
    diagnostics.push({
      severity: "error",
      code: "tool_import_failed",
      message: `Unable to list tools: ${_errorMessage(error)}`,
      path: toolsRoot,
    });
    return [];
  }

  const tools: AgentTool[] = [];
  const names = new Map<string, string>();
  for (const entry of entries) {
    const path = join(toolsRoot, entry);
    try {
      if ((await lstat(path)).isSymbolicLink()) {
        diagnostics.push({
          severity: "error",
          code: "tool_import_failed",
          message: `Symbolic-link tools are not supported: ${entry}`,
          path,
        });
        continue;
      }
      hash.update(path);
      const source = await readFile(path);
      hash.update(source);
      const moduleVersion = createHash("sha256").update(source).digest("hex");
      const module = await _importToolModule(path, moduleVersion);
      const tool =
        module && typeof module === "object" && "default" in module
          ? module.default
          : undefined;
      if (!_isAgentTool(tool)) {
        diagnostics.push({
          severity: "error",
          code: "tool_export_invalid",
          message: `${basename(path)} must default-export a Pi AgentTool`,
          path,
        });
        continue;
      }
      const previous = names.get(tool.name);
      if (previous) {
        diagnostics.push({
          severity: "error",
          code: "tool_name_duplicate",
          message: `Tool name "${tool.name}" is also exported by ${basename(previous)}`,
          path,
        });
        continue;
      }
      names.set(tool.name, path);
      tools.push(tool);
    } catch (error) {
      diagnostics.push({
        severity: "error",
        code: "tool_import_failed",
        message: `Unable to import ${entry}: ${_errorMessage(error)}`,
        path,
      });
    }
  }
  return tools;
}

async function _isSymlink(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isSymbolicLink();
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function _isAgentTool(value: unknown): value is AgentTool {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<AgentTool>;
  return (
    typeof candidate.name === "string" &&
    candidate.name.length > 0 &&
    typeof candidate.description === "string" &&
    typeof candidate.execute === "function" &&
    candidate.parameters !== undefined
  );
}

function _errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function _findSymlinks(root: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
  const result: string[] = [];
  for (const entry of entries) {
    const full = join(root, entry.name);
    if (entry.isSymbolicLink()) {
      result.push(full);
    } else if (entry.isDirectory()) {
      result.push(...(await _findSymlinks(full)));
    }
  }
  return result;
}

async function _importToolModule(
  path: string,
  version: string
): Promise<{ default?: unknown }> {
  const result = await Bun.build({
    entrypoints: [path],
    bundle: true,
    format: "esm",
    target: "bun",
    write: false,
    sourcemap: "inline",
  } as Parameters<typeof Bun.build>[0]);
  if (!result.success || !result.outputs[0]) {
    throw new Error(
      result.logs.map((log) => log.message).join("\n") ||
        `Unable to compile ${path}`
    );
  }
  const source = await result.outputs[0].text();
  // macOS exposes the temporary directory through both `/var` and
  // `/private/var`. Canonicalize before dynamic import so Bun's module cache
  // and the path we wrote always name the same file.
  const cacheRoot = join(await realpath(tmpdir()), "llm-space-runtime-tools");
  const cachePath = join(cacheRoot, `${version}.mjs`);
  await mkdir(cacheRoot, { recursive: true });
  try {
    await writeFile(cachePath, source, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if (!(
      error instanceof Error &&
      "code" in error &&
      error.code === "EEXIST"
    )) {
      throw error;
    }
  }
  const module: unknown = await import(
    `${pathToFileURL(cachePath).href}?v=${version}`
  );
  return module && typeof module === "object" && "default" in module
    ? { default: module.default }
    : {};
}
