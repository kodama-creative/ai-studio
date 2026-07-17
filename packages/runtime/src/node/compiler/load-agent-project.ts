import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  loadSkills,
  NodeExecutionEnv
} from "@earendil-works/pi-agent-core/node";
import { Compile } from "typebox/compile";

import { compileAgentDefinition } from "./compile-agent-definition";
import { compileAgentStateDefinition } from "./compile-agent-state-definition";
import {
  type AgentProjectArtifactDependencyInput,
  type AgentProjectArtifactSourceInput,
  createAgentProjectArtifact
} from "./create-agent-project-artifact";
import { loadAuthoredModule } from "./load-authored-module";
import { assertNoDuplicateObjectLiteralKeys } from "./validate-authored-source";
import { normalizeAgentDefinition } from "../../internal/authored-definition/normalize-agent-definition";
import {
  isDynamicInstructionsDefinition,
  isInstructionsDefinition
} from "../../internal/authored-instruction-definitions";
import { getActiveAgentSessionContextRuntime } from "../../internal/authored-state-definitions";
import { qualifyProjectMcpToolName } from "../../internal/project-mcp-tool-name";
import { isMcpClientConnectionDefinition } from "../../public/definitions/connections/mcp";
import { isStateDefinition } from "../../public/definitions/state";
import { isToolDefinition } from "../../public/definitions/tool";
import { createImmutableAgentProjectSnapshot } from "../../runtime/agent/create-immutable-agent-project-snapshot";
import { assertRuntimeSessionStateValues } from "../../runtime/harness/in-memory-session-store";
import {
  type AgentProjectSourceRef,
  discoverAgentProject,
  type DiscoveredAgentProject
} from "../discover/discover-agent-project";

import type {
  CompiledAgentInstructionEntry,
  CompiledAgentProjectSnapshot,
  CompiledAgentStateDefinition,
  CompiledMcpConnection,
  CompiledProjectTool
} from "../../runtime/agent/agent-project-snapshot";
import type { CompiledAgentDefinition } from "../../shared/agent-definition";
import type { AgentProjectDiagnostic } from "../../shared/agent-project";
import type { AgentSessionContext } from "../../shared/agent-session-context";

export async function loadAgentProject(
  agentRoot: string
): Promise<CompiledAgentProjectSnapshot> {
  return _compileAgentProject(await discoverAgentProject(agentRoot));
}

async function _compileAgentProject(
  discovered: DiscoveredAgentProject
): Promise<CompiledAgentProjectSnapshot> {
  const diagnostics = [...discovered.diagnostics];
  const dependencies: AgentProjectArtifactDependencyInput[] = [];
  const sources: AgentProjectArtifactSourceInput[] = [];
  const definition = await _compileDefinition(
    discovered.definition,
    diagnostics,
    dependencies,
    discovered.root,
    sources
  );
  const instructionEntries = await _compileInstructions(
    discovered.instructions,
    discovered.instructionEntries,
    diagnostics,
    dependencies,
    discovered.root,
    sources
  );
  const staticInstructionEntries = instructionEntries.filter(
    (entry): entry is Extract<CompiledAgentInstructionEntry, {
      kind: "static";
    }> => entry.kind === "static"
  );
  const instructions = instructionEntries.length === 1
    && staticInstructionEntries[0]?.sourcePath === "instructions.md"
    ? staticInstructionEntries[0].markdown
    : staticInstructionEntries
      .map(entry => entry.markdown.trim())
      .filter(Boolean)
      .join("\n\n");
  const stateDefinitions = await _compileStateDefinitions(
    discovered.states,
    diagnostics,
    dependencies,
    discovered.root,
    sources
  );
  const tools = await _compileTools(
    discovered.tools,
    diagnostics,
    dependencies,
    discovered.root,
    sources
  );
  const connections = await _compileConnections(
    discovered.connections,
    diagnostics,
    dependencies,
    discovered.root,
    sources,
    new Map(
      tools.map(tool => [
        tool.name,
        tool.sourcePath ?? `tools/${tool.name}.ts`
      ])
    )
  );
  const skills = await _compileSkills(discovered, diagnostics, sources);
  const artifact = createAgentProjectArtifact({
    connections,
    definition,
    dependencies,
    instructions,
    instructionEntries,
    skills,
    stateDefinitions,
    sources,
    tools
  });
  return createImmutableAgentProjectSnapshot({
    artifact,
    root: discovered.root,
    definition,
    instructions,
    tools,
    connections,
    resources: { skills },
    instructionEntries,
    stateDefinitions,
    diagnostics,
    fingerprint: artifact.fingerprint
  });
}

async function _compileStateDefinitions(
  sourceRefs: readonly AgentProjectSourceRef[],
  diagnostics: AgentProjectDiagnostic[],
  dependencies: AgentProjectArtifactDependencyInput[],
  projectRoot: string,
  sources: AgentProjectArtifactSourceInput[]
): Promise<CompiledAgentStateDefinition[]> {
  const definitions: CompiledAgentStateDefinition[] = [];
  const names = new Map<string, string>();
  for (const sourceRef of sourceRefs) {
    try {
      const loaded = await loadAuthoredModule({
        projectRoot,
        sourcePath: sourceRef.absolutePath,
        authoredSdk: true
      });
      _recordDependencies(dependencies, sourceRef.logicalPath, loaded.dependencies);
      sources.push({ id: sourceRef.logicalPath, content: loaded.source });
      const definition = loaded.default;
      if (!isStateDefinition(definition)) {
        diagnostics.push({
          severity: "error",
          code: "state_export_invalid",
          message: `${path.basename(sourceRef.absolutePath)} must default-export defineState({ name, version, schema, initial })`,
          path: sourceRef.absolutePath
        });
        continue;
      }
      const previous = names.get(definition.name);
      if (previous) {
        diagnostics.push({
          severity: "error",
          code: "state_name_duplicate",
          message: `State name "${definition.name}" is also exported by ${path.basename(previous)}`,
          path: sourceRef.absolutePath
        });
        continue;
      }
      names.set(definition.name, sourceRef.absolutePath);
      definitions.push(compileAgentStateDefinition(
        definition,
        sourceRef.logicalPath
      ));
    } catch (error) {
      diagnostics.push({
        severity: "error",
        code: "state_import_failed",
        message: `Unable to import ${path.basename(sourceRef.absolutePath)}: ${_errorMessage(error)}`,
        path: sourceRef.absolutePath
      });
    }
  }
  if (definitions.length > 64) {
    diagnostics.push({
      severity: "error",
      code: "state_export_invalid",
      message: "Agent Projects support at most 64 state definitions",
      path: projectRoot
    });
  }
  try {
    assertRuntimeSessionStateValues(Object.fromEntries(
      definitions.map(definition => [definition.name, {
        definitionVersion: definition.version,
        schemaFingerprint: definition.schemaFingerprint,
        value: definition.initial
      }])
    ));
  } catch (error) {
    diagnostics.push({
      severity: "error",
      code: "state_export_invalid",
      message: _errorMessage(error),
      path: projectRoot
    });
  }
  return definitions;
}

async function _compileDefinition(
  sourceRef: AgentProjectSourceRef | undefined,
  diagnostics: AgentProjectDiagnostic[],
  dependencies: AgentProjectArtifactDependencyInput[],
  projectRoot: string,
  sources: AgentProjectArtifactSourceInput[]
): Promise<CompiledAgentDefinition | undefined> {
  if (!sourceRef) { return undefined; }
  let authored: unknown;
  try {
    const loaded = await loadAuthoredModule({
      projectRoot,
      sourcePath: sourceRef.absolutePath,
      authoredSdk: true,
      validateEntrySource: assertNoDuplicateObjectLiteralKeys
    });
    _recordDependencies(dependencies, sourceRef.logicalPath, loaded.dependencies);
    sources.push({ id: sourceRef.logicalPath, content: loaded.source });
    authored = loaded.default;
  } catch (error) {
    diagnostics.push({
      severity: "error",
      code: "definition_import_failed",
      message: `Unable to import agent.ts: ${_errorMessage(error)}`,
      path: sourceRef.absolutePath
    });
    return undefined;
  }
  try {
    return compileAgentDefinition(
      normalizeAgentDefinition(
        authored,
        "agent.ts must default-export defineAgent({ model, reasoning?, environment? })"
      )
    );
  } catch (error) {
    diagnostics.push({
      severity: "error",
      code: "definition_export_invalid",
      message: _errorMessage(error),
      path: sourceRef.absolutePath
    });
    return undefined;
  }
}

async function _compileInstructions(
  rootSource: AgentProjectSourceRef | undefined,
  entrySources: readonly AgentProjectSourceRef[],
  diagnostics: AgentProjectDiagnostic[],
  dependencies: AgentProjectArtifactDependencyInput[],
  projectRoot: string,
  sources: AgentProjectArtifactSourceInput[]
): Promise<CompiledAgentInstructionEntry[]> {
  const compiled: CompiledAgentInstructionEntry[] = [];
  if (rootSource) {
    try {
      const markdown = await readFile(rootSource.absolutePath, "utf8");
      sources.push({ id: rootSource.logicalPath, content: markdown });
      compiled.push({
        kind: "static",
        markdown,
        sourcePath: rootSource.logicalPath
      });
    } catch (error) {
      diagnostics.push({
        severity: "error",
        code: "instructions_read_failed",
        message: `Unable to read instructions.md: ${_errorMessage(error)}`,
        path: rootSource.absolutePath
      });
    }
  }
  for (const source of entrySources) {
    try {
      if (source.logicalPath.endsWith(".md")) {
        const markdown = await readFile(source.absolutePath, "utf8");
        sources.push({ id: source.logicalPath, content: markdown });
        compiled.push({ kind: "static", markdown, sourcePath: source.logicalPath });
        continue;
      }
      const loaded = await loadAuthoredModule({
        projectRoot,
        sourcePath: source.absolutePath,
        authoredSdk: true,
        restrictInstructionImports: true
      });
      _recordDependencies(dependencies, source.logicalPath, loaded.dependencies);
      sources.push({ id: source.logicalPath, content: loaded.source });
      if (isInstructionsDefinition(loaded.default)) {
        compiled.push({
          kind: "static",
          markdown: loaded.default.markdown,
          sourcePath: source.logicalPath
        });
      } else if (isDynamicInstructionsDefinition(loaded.default)) {
        compiled.push({
          kind: "dynamic",
          definition: loaded.default,
          sourcePath: source.logicalPath
        });
      } else {
        throw new TypeError(
          "TypeScript instruction entries must default-export defineInstructions(...) or defineDynamic(...)"
        );
      }
    } catch (error) {
      diagnostics.push({
        severity: "error",
        code: "instruction_entry_import_failed",
        message: `Unable to compile ${path.basename(source.absolutePath)}: ${_errorMessage(error)}`,
        path: source.absolutePath
      });
    }
  }
  return compiled;
}

async function _compileTools(
  sourceRefs: readonly AgentProjectSourceRef[],
  diagnostics: AgentProjectDiagnostic[],
  dependencies: AgentProjectArtifactDependencyInput[],
  projectRoot: string,
  sources: AgentProjectArtifactSourceInput[]
): Promise<CompiledProjectTool[]> {
  const tools: CompiledProjectTool[] = [];
  const names = new Map<string, string>();
  for (const sourceRef of sourceRefs) {
    try {
      const loaded = await loadAuthoredModule({
        projectRoot,
        sourcePath: sourceRef.absolutePath,
        authoredSdk: true
      });
      _recordDependencies(
        dependencies,
        sourceRef.logicalPath,
        loaded.dependencies
      );
      sources.push({ id: sourceRef.logicalPath, content: loaded.source });
      const definition = loaded.default;
      if (!isToolDefinition(definition)) {
        diagnostics.push({
          severity: "error",
          code: "tool_export_invalid",
          message: `${path.basename(sourceRef.absolutePath)} must default-export defineTool({ description, inputSchema, execute })`,
          path: sourceRef.absolutePath
        });
        continue;
      }
      if ("name" in definition || "label" in definition) {
        diagnostics.push({
          severity: "error",
          code: "tool_export_invalid",
          message: `${path.basename(sourceRef.absolutePath)}: Remove authored name/label fields; tool identity comes from the filename.`,
          path: sourceRef.absolutePath
        });
        continue;
      }
      const name = path.basename(sourceRef.absolutePath, path.extname(sourceRef.absolutePath));
      if (!_isModelName(name)) {
        diagnostics.push({
          severity: "error",
          code: "tool_export_invalid",
          message: `Tool filename must match ${MODEL_NAME_PATTERN.source}: ${name}`,
          path: sourceRef.absolutePath
        });
        continue;
      }
      const previous = names.get(name);
      if (previous) {
        diagnostics.push({
          severity: "error",
          code: "tool_name_duplicate",
          message: `Tool name "${name}" is also exported by ${path.basename(previous)}`,
          path: sourceRef.absolutePath
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
        outputSchema: definition.outputSchema,
        sourcePath: sourceRef.logicalPath,
        async execute(toolCallId, input, signal) {
          if (!inputValidator.Check(input)) {
            throw new TypeError(`Invalid input for tool "${name}"`);
          }
          const output = await definition.execute(input, {
            abortSignal: signal ?? new AbortController().signal,
            callId: toolCallId,
            toolName: name,
            get session() {
              return getActiveAgentSessionContextRuntime() as
                AgentSessionContext;
            }
          });
          if (outputValidator && !outputValidator.Check(output)) {
            throw new TypeError(`Invalid output from tool "${name}"`);
          }
          const text = _serializeToolOutput(output, name);
          return {
            content: [{ type: "text", text }],
            details: output
          };
        }
      });
    } catch (error) {
      diagnostics.push({
        severity: "error",
        code: "tool_import_failed",
        message: `Unable to import ${path.basename(sourceRef.absolutePath)}: ${_errorMessage(error)}`,
        path: sourceRef.absolutePath
      });
    }
  }
  return tools;
}

async function _compileConnections(
  sourceRefs: readonly AgentProjectSourceRef[],
  diagnostics: AgentProjectDiagnostic[],
  dependencies: AgentProjectArtifactDependencyInput[],
  projectRoot: string,
  sources: AgentProjectArtifactSourceInput[],
  occupiedToolNames: Map<string, string>
): Promise<CompiledMcpConnection[]> {
  const connections: CompiledMcpConnection[] = [];
  const connectionNames = new Map<string, string>();
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
        path: sourceRef.absolutePath
      });
      continue;
    }
    const previousConnection = connectionNames.get(name);
    if (previousConnection) {
      diagnostics.push({
        severity: "error",
        code: "connection_name_duplicate",
        message: `Connection name "${name}" is also exported by ${path.basename(previousConnection)}`,
        path: sourceRef.absolutePath
      });
      continue;
    }
    connectionNames.set(name, sourceRef.absolutePath);
    try {
      const loaded = await loadAuthoredModule({
        projectRoot,
        sourcePath: sourceRef.absolutePath,
        authoredSdk: true
      });
      _recordDependencies(
        dependencies,
        sourceRef.logicalPath,
        loaded.dependencies
      );
      sources.push({ id: sourceRef.logicalPath, content: loaded.source });
      const definition = loaded.default;
      if (!isMcpClientConnectionDefinition(definition)) {
        diagnostics.push({
          severity: "error",
          code: "connection_export_invalid",
          message: `${path.basename(sourceRef.absolutePath)} must default-export defineMcpClientConnection({ ... })`,
          path: sourceRef.absolutePath
        });
        continue;
      }
      const qualifiedNames: string[] = [];
      let collision = false;
      for (const toolName of definition.tools.allow) {
        if (!_isModelName(toolName)) {
          throw new TypeError(`Invalid allowlisted MCP tool name: ${toolName}`);
        }
        const qualifiedName = qualifyProjectMcpToolName(name, toolName);
        if (!_isModelName(qualifiedName)) {
          throw new TypeError(
            `Qualified MCP tool name is not provider-safe: ${qualifiedName}`
          );
        }
        const previous =
          occupiedToolNames.get(qualifiedName)
          ?? (qualifiedNames.includes(qualifiedName)
            ? sourceRef.logicalPath
            : undefined);
        if (previous) {
          diagnostics.push({
            severity: "error",
            code: "tool_name_duplicate",
            message: `Tool name "${qualifiedName}" is also exported by ${path.basename(previous)}`,
            path: sourceRef.absolutePath
          });
          collision = true;
          break;
        }
        qualifiedNames.push(qualifiedName);
      }
      if (collision) { continue; }
      for (const qualifiedName of qualifiedNames) {
        occupiedToolNames.set(qualifiedName, sourceRef.logicalPath);
      }
      connections.push({ name, logicalPath: sourceRef.logicalPath, definition });
    } catch (error) {
      diagnostics.push({
        severity: "error",
        code: "connection_import_failed",
        message: `Unable to import ${path.basename(sourceRef.absolutePath)}: ${_errorMessage(error)}`,
        path: sourceRef.absolutePath
      });
    }
  }
  return connections;
}

async function _compileSkills(
  discovered: DiscoveredAgentProject,
  diagnostics: AgentProjectDiagnostic[],
  sources: AgentProjectArtifactSourceInput[]
) {
  if (!discovered.skillsRoot) { return []; }
  const env = new NodeExecutionEnv({ cwd: discovered.root });
  try {
    const loaded = await loadSkills(env, discovered.skillsRoot);
    for (const diagnostic of loaded.diagnostics) {
      diagnostics.push({
        severity: "error",
        code: "skill_invalid",
        message: diagnostic.message,
        path: diagnostic.path
      });
    }
    for (const skill of loaded.skills) {
      sources.push({
        id: _logicalSkillPath(discovered.root, skill.filePath),
        content: skill.content
      });
    }
    return loaded.skills;
  } catch (error) {
    diagnostics.push({
      severity: "error",
      code: "skill_invalid",
      message: `Unable to load skills: ${_errorMessage(error)}`,
      path: discovered.skillsRoot
    });
    return [];
  } finally {
    await env.cleanup();
  }
}

function _logicalSkillPath(root: string, filePath: string): string {
  const relative = path.relative(root, filePath);
  return relative && !relative.startsWith(`..${path.sep}`)
    ? relative.split(path.sep).join(path.posix.sep)
    : path.posix.join(
      "skills",
      path.basename(path.dirname(filePath)),
      path.basename(filePath)
    );
}

function _recordDependencies(
  target: AgentProjectArtifactDependencyInput[],
  sourceId: string,
  dependencies: readonly AgentProjectArtifactDependencyInput[]
): void {
  for (const dependency of dependencies) {
    target.push({
      id: `${sourceId} -> ${dependency.id}`,
      fingerprint: dependency.fingerprint
    });
  }
}

const MODEL_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/;

function _isModelName(value: string): boolean {
  return MODEL_NAME_PATTERN.test(value);
}

function _serializeToolOutput(output: unknown, name: string): string {
  _assertJsonValue(output, name, new WeakSet());
  if (typeof output === "string") { return output; }
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
    value === null
    || typeof value === "string"
    || typeof value === "boolean"
  ) {
    return;
  }
  if (typeof value === "number") {
    if (Number.isFinite(value)) { return; }
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
