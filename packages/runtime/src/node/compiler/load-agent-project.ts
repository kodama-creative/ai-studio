import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  loadSkills,
  NodeExecutionEnv,
  type AgentTool,
} from "@earendil-works/pi-agent-core/node";

import { normalizeAgentDefinition } from "../../internal/authored-definition/normalize-agent-definition";
import type { AgentProjectSnapshot } from "../../runtime/agent/agent-project-snapshot";
import { createImmutableAgentProjectSnapshot } from "../../runtime/agent/create-immutable-agent-project-snapshot";
import type { CompiledAgentDefinition } from "../../shared/agent-definition";
import type { AgentProjectDiagnostic } from "../../shared/agent-project";
import {
  discoverAgentProject,
  type AgentProjectSourceRef,
  type DiscoveredAgentProject,
} from "../discover/discover-agent-project";

import { compileAgentDefinition } from "./compile-agent-definition";
import { loadAuthoredModule } from "./load-authored-module";

export async function loadAgentProject(
  agentRoot: string
): Promise<AgentProjectSnapshot> {
  return _compileAgentProject(await discoverAgentProject(agentRoot));
}

async function _compileAgentProject(
  discovered: DiscoveredAgentProject
): Promise<AgentProjectSnapshot> {
  const diagnostics = [...discovered.diagnostics];
  const hash = createHash("sha256");
  const definition = await _compileDefinition(
    discovered.definition,
    diagnostics,
    hash
  );
  const instructions = await _compileInstructions(
    discovered.instructions,
    diagnostics,
    hash
  );
  const tools = await _compileTools(discovered.tools, diagnostics, hash);
  const skills = await _compileSkills(discovered, diagnostics, hash);
  return createImmutableAgentProjectSnapshot({
    root: discovered.root,
    definition,
    instructions,
    tools,
    resources: { skills },
    diagnostics,
    fingerprint: hash.digest("hex"),
  });
}

async function _compileDefinition(
  sourceRef: AgentProjectSourceRef | undefined,
  diagnostics: AgentProjectDiagnostic[],
  hash: ReturnType<typeof createHash>
): Promise<CompiledAgentDefinition | undefined> {
  if (!sourceRef) return undefined;
  let source: Uint8Array;
  let authored: unknown;
  try {
    source = await readFile(sourceRef.absolutePath);
    hash.update(sourceRef.absolutePath);
    hash.update(source);
    const version = createHash("sha256").update(source).digest("hex");
    authored = (
      await loadAuthoredModule({
        sourcePath: sourceRef.absolutePath,
        version,
        authoredSdk: true,
      })
    ).default;
  } catch (error) {
    diagnostics.push({
      severity: "error",
      code: "definition_import_failed",
      message: `Unable to import agent.ts: ${_errorMessage(error)}`,
      path: sourceRef.absolutePath,
    });
    return undefined;
  }
  try {
    return compileAgentDefinition(
      normalizeAgentDefinition(
        authored,
        "agent.ts must default-export defineAgent({ model, reasoning? })"
      )
    );
  } catch (error) {
    diagnostics.push({
      severity: "error",
      code: "definition_export_invalid",
      message: _errorMessage(error),
      path: sourceRef.absolutePath,
    });
    return undefined;
  }
}

async function _compileInstructions(
  sourceRef: AgentProjectSourceRef | undefined,
  diagnostics: AgentProjectDiagnostic[],
  hash: ReturnType<typeof createHash>
): Promise<string> {
  if (!sourceRef) return "";
  try {
    const instructions = await readFile(sourceRef.absolutePath, "utf8");
    hash.update(sourceRef.absolutePath);
    hash.update(instructions);
    return instructions;
  } catch (error) {
    diagnostics.push({
      severity: "error",
      code: "instructions_read_failed",
      message: `Unable to read instructions.md: ${_errorMessage(error)}`,
      path: sourceRef.absolutePath,
    });
    return "";
  }
}

async function _compileTools(
  sourceRefs: readonly AgentProjectSourceRef[],
  diagnostics: AgentProjectDiagnostic[],
  hash: ReturnType<typeof createHash>
): Promise<AgentTool[]> {
  const tools: AgentTool[] = [];
  const names = new Map<string, string>();
  for (const sourceRef of sourceRefs) {
    try {
      const source = await readFile(sourceRef.absolutePath);
      hash.update(sourceRef.absolutePath);
      hash.update(source);
      const version = createHash("sha256").update(source).digest("hex");
      const tool = (
        await loadAuthoredModule({
          sourcePath: sourceRef.absolutePath,
          version,
        })
      ).default;
      if (!_isAgentTool(tool)) {
        diagnostics.push({
          severity: "error",
          code: "tool_export_invalid",
          message: `${path.basename(sourceRef.absolutePath)} must default-export a Pi AgentTool`,
          path: sourceRef.absolutePath,
        });
        continue;
      }
      const previous = names.get(tool.name);
      if (previous) {
        diagnostics.push({
          severity: "error",
          code: "tool_name_duplicate",
          message: `Tool name "${tool.name}" is also exported by ${path.basename(previous)}`,
          path: sourceRef.absolutePath,
        });
        continue;
      }
      names.set(tool.name, sourceRef.absolutePath);
      tools.push(tool);
    } catch (error) {
      diagnostics.push({
        severity: "error",
        code: "tool_import_failed",
        message: `Unable to import ${path.basename(sourceRef.absolutePath)}: ${_errorMessage(error)}`,
        path: sourceRef.absolutePath,
      });
    }
  }
  return tools;
}

async function _compileSkills(
  discovered: DiscoveredAgentProject,
  diagnostics: AgentProjectDiagnostic[],
  hash: ReturnType<typeof createHash>
) {
  if (!discovered.skillsRoot) return [];
  const env = new NodeExecutionEnv({ cwd: discovered.root });
  try {
    const loaded = await loadSkills(env, discovered.skillsRoot);
    for (const diagnostic of loaded.diagnostics) {
      diagnostics.push({
        severity: "error",
        code: "skill_invalid",
        message: diagnostic.message,
        path: diagnostic.path,
      });
    }
    for (const skill of loaded.skills) {
      hash.update(skill.filePath);
      hash.update(skill.content);
    }
    return loaded.skills;
  } catch (error) {
    diagnostics.push({
      severity: "error",
      code: "skill_invalid",
      message: `Unable to load skills: ${_errorMessage(error)}`,
      path: discovered.skillsRoot,
    });
    return [];
  } finally {
    await env.cleanup();
  }
}

function _isAgentTool(value: unknown): value is AgentTool {
  if (!value || typeof value !== "object") return false;
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
