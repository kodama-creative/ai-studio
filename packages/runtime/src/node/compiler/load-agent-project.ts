import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  loadSkills,
  NodeExecutionEnv,
} from "@earendil-works/pi-agent-core/node";
import { Compile } from "typebox/compile";

import { normalizeAgentDefinition } from "../../internal/authored-definition/normalize-agent-definition";
import {
  type AgentProjectSnapshot,
  type CompiledMcpConnection,
  type CompiledProjectTool,
} from "../../runtime/agent/agent-project-snapshot";
import { createImmutableAgentProjectSnapshot } from "../../runtime/agent/create-immutable-agent-project-snapshot";
import { isMcpClientConnectionDefinition } from "../../public/definitions/connections/mcp";
import { isToolDefinition } from "../../public/definitions/tool";
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
  const connections = await _compileConnections(
    discovered.connections,
    diagnostics,
    hash,
    new Map(
      tools.map((tool) => [
        tool.name,
        tool.sourcePath ?? `tools/${tool.name}.ts`,
      ])
    )
  );
  const skills = await _compileSkills(discovered, diagnostics, hash);
  return createImmutableAgentProjectSnapshot({
    root: discovered.root,
    definition,
    instructions,
    tools,
    connections,
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
): Promise<CompiledProjectTool[]> {
  const tools: CompiledProjectTool[] = [];
  const names = new Map<string, string>();
  for (const sourceRef of sourceRefs) {
    try {
      const source = await readFile(sourceRef.absolutePath);
      hash.update(sourceRef.absolutePath);
      hash.update(source);
      const version = createHash("sha256").update(source).digest("hex");
      const definition = (
        await loadAuthoredModule({
          sourcePath: sourceRef.absolutePath,
          version,
          authoredSdk: true,
        })
      ).default;
      if (!isToolDefinition(definition)) {
        diagnostics.push({
          severity: "error",
          code: "tool_export_invalid",
          message: `${path.basename(sourceRef.absolutePath)} must default-export defineTool({ description, inputSchema, execute })`,
          path: sourceRef.absolutePath,
        });
        continue;
      }
      const name = path.basename(sourceRef.absolutePath, path.extname(sourceRef.absolutePath));
      if (!_isModelName(name)) {
        diagnostics.push({
          severity: "error",
          code: "tool_export_invalid",
          message: `Tool filename must match ${MODEL_NAME_PATTERN.source}: ${name}`,
          path: sourceRef.absolutePath,
        });
        continue;
      }
      const previous = names.get(name);
      if (previous) {
        diagnostics.push({
          severity: "error",
          code: "tool_name_duplicate",
          message: `Tool name "${name}" is also exported by ${path.basename(previous)}`,
          path: sourceRef.absolutePath,
        });
        continue;
      }
      names.set(name, sourceRef.absolutePath);
      const inputValidator = Compile(definition.inputSchema);
      const outputValidator = definition.outputSchema
        ? Compile(definition.outputSchema)
        : null;
      tools.push({
        name,
        label: name,
        description: definition.description,
        parameters: definition.inputSchema,
        sourcePath: sourceRef.logicalPath,
        async execute(toolCallId, input, signal) {
          if (!inputValidator.Check(input)) {
            throw new TypeError(`Invalid input for tool "${name}"`);
          }
          const output = await definition.execute(input, {
            abortSignal: signal ?? new AbortController().signal,
            callId: toolCallId,
            toolName: name,
          });
          if (outputValidator && !outputValidator.Check(output)) {
            throw new TypeError(`Invalid output from tool "${name}"`);
          }
          const text = _serializeToolOutput(output, name);
          return {
            content: [{ type: "text", text }],
            details: output,
          };
        },
      });
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

async function _compileConnections(
  sourceRefs: readonly AgentProjectSourceRef[],
  diagnostics: AgentProjectDiagnostic[],
  hash: ReturnType<typeof createHash>,
  occupiedToolNames: Map<string, string>
): Promise<CompiledMcpConnection[]> {
  const connections: CompiledMcpConnection[] = [];
  for (const sourceRef of sourceRefs) {
    const name = path.basename(
      sourceRef.absolutePath,
      path.extname(sourceRef.absolutePath)
    );
    if (!_isModelName(name)) {
      diagnostics.push({
        severity: "error",
        code: "connection_name_invalid",
        message: `Connection filename must match ${MODEL_NAME_PATTERN.source}: ${name}`,
        path: sourceRef.absolutePath,
      });
      continue;
    }
    try {
      const source = await readFile(sourceRef.absolutePath);
      hash.update(sourceRef.absolutePath);
      hash.update(source);
      const version = createHash("sha256").update(source).digest("hex");
      const definition = (
        await loadAuthoredModule({
          sourcePath: sourceRef.absolutePath,
          version,
          authoredSdk: true,
        })
      ).default;
      if (!isMcpClientConnectionDefinition(definition)) {
        diagnostics.push({
          severity: "error",
          code: "connection_export_invalid",
          message: `${path.basename(sourceRef.absolutePath)} must default-export defineMcpClientConnection({ ... })`,
          path: sourceRef.absolutePath,
        });
        continue;
      }
      const qualifiedNames: string[] = [];
      let collision = false;
      for (const toolName of definition.tools.allow) {
        if (!_isModelName(toolName)) {
          throw new TypeError(`Invalid allowlisted MCP tool name: ${toolName}`);
        }
        const qualifiedName = `${name}__${toolName}`;
        if (!_isModelName(qualifiedName)) {
          throw new TypeError(
            `Qualified MCP tool name is not provider-safe: ${qualifiedName}`
          );
        }
        const previous =
          occupiedToolNames.get(qualifiedName) ??
          (qualifiedNames.includes(qualifiedName)
            ? sourceRef.logicalPath
            : undefined);
        if (previous) {
          diagnostics.push({
            severity: "error",
            code: "tool_name_duplicate",
            message: `Tool name "${qualifiedName}" is also exported by ${path.basename(previous)}`,
            path: sourceRef.absolutePath,
          });
          collision = true;
          break;
        }
        qualifiedNames.push(qualifiedName);
      }
      if (collision) continue;
      for (const qualifiedName of qualifiedNames) {
        occupiedToolNames.set(qualifiedName, sourceRef.logicalPath);
      }
      connections.push({ name, logicalPath: sourceRef.logicalPath, definition });
    } catch (error) {
      diagnostics.push({
        severity: "error",
        code: "connection_import_failed",
        message: `Unable to import ${path.basename(sourceRef.absolutePath)}: ${_errorMessage(error)}`,
        path: sourceRef.absolutePath,
      });
    }
  }
  return connections;
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

const MODEL_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/;

function _isModelName(value: string): boolean {
  return MODEL_NAME_PATTERN.test(value);
}

function _serializeToolOutput(output: unknown, name: string): string {
  _assertJsonValue(output, name, new WeakSet());
  if (typeof output === "string") return output;
  const text = JSON.stringify(output);
  if (text === undefined) {
    throw new TypeError(`Tool "${name}" returned a non-JSON value`);
  }
  return text;
}

function _assertJsonValue(
  value: unknown,
  name: string,
  ancestors: WeakSet<object>
): void {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return;
  }
  if (typeof value === "number") {
    if (Number.isFinite(value)) return;
    throw new TypeError(`Tool "${name}" returned a non-JSON number`);
  }
  if (typeof value !== "object") {
    throw new TypeError(`Tool "${name}" returned a non-JSON value`);
  }
  if (ancestors.has(value)) {
    throw new TypeError(`Tool "${name}" returned circular JSON data`);
  }
  const prototype = Object.getPrototypeOf(value) as object | null;
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`Tool "${name}" returned a non-plain JSON object`);
  }
  ancestors.add(value);
  for (const child of Array.isArray(value) ? value : Object.values(value)) {
    _assertJsonValue(child, name, ancestors);
  }
  ancestors.delete(value);
}

function _errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
