import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import {
  loadSkills,
  NodeExecutionEnv
} from "@earendil-works/pi-agent-core/node";

import { assertDynamicToolSource } from "./assert-dynamic-tool-source";
import { compileAgentDefinition } from "./compile-agent-definition";
import { compileAgentOutputDefinition } from "./compile-agent-output-definition";
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
  isDynamicToolsDefinition
} from "../../internal/authored-dynamic-tools-definition";
import {
  isDynamicInstructionsDefinition,
  isInstructionsDefinition
} from "../../internal/authored-instruction-definitions";
import { getActiveAgentSessionContextRuntime } from "../../internal/authored-state-definitions";
import { qualifyProjectMcpToolName } from "../../internal/project-mcp-tool-name";
import { isMcpClientConnectionDefinition } from "../../public/definitions/connections/mcp";
import { isExecutionEnvToolDefinition } from "../../public/definitions/execution-env-tool";
import { isOutputDefinition } from "../../public/definitions/output";
import { isSandboxDefinition } from "../../public/definitions/sandbox";
import { isStateDefinition } from "../../public/definitions/state";
import { isToolDefinition } from "../../public/definitions/tool";
import { createCompiledExecutionEnvTool } from "../../runtime/agent/create-compiled-execution-env-tool";
import { createCompiledProjectTool } from "../../runtime/agent/create-compiled-project-tool";
import { createImmutableAgentProjectSnapshot } from "../../runtime/agent/create-immutable-agent-project-snapshot";
import { assertRuntimeSessionStateValues } from "../../runtime/harness/in-memory-session-store";
import { isAgentToolName } from "../../shared/is-agent-tool-name";
import { STRUCTURED_OUTPUT_TOOL_NAME } from "../../shared/structured-output";
import {
  type AgentProjectSourceRef,
  discoverAgentProject,
  type DiscoveredAgentProject
} from "../discover/discover-agent-project";

import type {
  CompiledAgentInstructionEntry,
  CompiledAgentOutputDefinition,
  CompiledAgentProjectSnapshot,
  CompiledAgentStateDefinition,
  CompiledAgentSubagent,
  CompiledDynamicToolResolver,
  CompiledMcpConnection,
  CompiledProjectTool,
  CompiledSandboxRequirement
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
  discovered: DiscoveredAgentProject,
  options: { readonly subagent?: boolean; } = {}
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
  if (options.subagent && !definition?.description) {
    diagnostics.push({
      severity: "error",
      code: "subagent_description_missing",
      message: "A Subagent agent.ts must define a non-empty description",
      path: discovered.definition?.absolutePath ?? discovered.root
    });
  }
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
  if (options.subagent && discovered.outputs.length > 0) {
    diagnostics.push(...discovered.outputs.map(output => ({
      severity: "error" as const,
      code: "subagent_output_unsupported" as const,
      message: "Subagent outputs are not supported in V1",
      path: output.absolutePath
    })));
  }
  const outputDefinitions = options.subagent
    ? []
    : await _compileOutputDefinitions(
      discovered.outputs,
      diagnostics,
      dependencies,
      discovered.root,
      sources
    );
  const sandbox = await _compileSandbox(
    discovered.sandbox,
    diagnostics,
    dependencies,
    discovered.root,
    sources
  );
  const compiledTools = await _compileTools(
    discovered.tools,
    diagnostics,
    dependencies,
    discovered.root,
    sources
  );
  const { dynamicToolResolvers, tools } = compiledTools;
  const occupiedToolNames = new Map(
    tools.map(tool => [
      tool.name,
      tool.sourcePath ?? `tools/${tool.name}.ts`
    ])
  );
  if (options.subagent && discovered.connections.length > 0) {
    diagnostics.push(...discovered.connections.map(connection => ({
      severity: "error" as const,
      code: "subagent_connection_unsupported" as const,
      message: "Subagent connections are not supported in V1",
      path: connection.absolutePath
    })));
  }
  const connections = options.subagent
    ? []
    : await _compileConnections(
      discovered.connections,
      diagnostics,
      dependencies,
      discovered.root,
      sources,
      occupiedToolNames
    );
  const skills = await _compileSkills(discovered, diagnostics, sources);
  const subagents = options.subagent
    ? []
    : await _compileSubagents(
      discovered,
      diagnostics,
      occupiedToolNames
    );
  const artifact = createAgentProjectArtifact({
    connections,
    definition,
    dependencies,
    instructions,
    instructionEntries,
    dynamicToolResolvers,
    skills,
    stateDefinitions,
    outputDefinitions,
    sandbox,
    sources,
    subagents,
    tools
  });
  return createImmutableAgentProjectSnapshot({
    artifact,
    root: discovered.root,
    definition,
    instructions,
    tools,
    dynamicToolResolvers,
    connections,
    resources: { skills },
    instructionEntries,
    stateDefinitions,
    outputDefinitions,
    sandbox,
    subagents,
    diagnostics,
    fingerprint: artifact.fingerprint
  });
}

async function _compileSubagents(
  discovered: DiscoveredAgentProject,
  diagnostics: AgentProjectDiagnostic[],
  occupiedToolNames: Map<string, string>
): Promise<CompiledAgentSubagent[]> {
  const compiled: CompiledAgentSubagent[] = [];
  for (const candidate of discovered.subagents) {
    const sourcePath = path.posix.join(
      "subagents",
      candidate.id,
      "agent.ts"
    );
    const project = await _compileAgentProject(candidate.project, {
      subagent: true
    });
    diagnostics.push(...project.diagnostics);
    const previous = occupiedToolNames.get(candidate.id);
    if (previous) {
      diagnostics.push({
        severity: "error",
        code: "tool_name_duplicate",
        message: `Subagent name "${candidate.id}" collides with the model-visible tool exported by ${path.basename(previous)}`,
        path: candidate.project.definition?.absolutePath ?? candidate.project.root
      });
      continue;
    }
    if (
      !project.definition?.description
      || project.diagnostics.some(diagnostic => diagnostic.severity === "error")
    ) {
      continue;
    }
    occupiedToolNames.set(candidate.id, sourcePath);
    compiled.push({
      id: candidate.id,
      description: project.definition.description,
      project
    });
  }
  return compiled;
}

async function _compileSandbox(
  discovered: DiscoveredAgentProject["sandbox"],
  diagnostics: AgentProjectDiagnostic[],
  dependencies: AgentProjectArtifactDependencyInput[],
  projectRoot: string,
  sources: AgentProjectArtifactSourceInput[]
): Promise<CompiledSandboxRequirement | undefined> {
  if (!discovered?.definition) { return undefined; }
  const sourceRef = discovered.definition;
  try {
    const workspaceRoot = path.join(
      await realpath(projectRoot),
      "sandbox",
      "workspace"
    );
    const loaded = await loadAuthoredModule({
      projectRoot,
      sourcePath: sourceRef.absolutePath,
      authoredSdk: true
    });
    _recordDependencies(dependencies, sourceRef.logicalPath, loaded.dependencies);
    sources.push({ id: sourceRef.logicalPath, content: loaded.source });
    if (!isSandboxDefinition(loaded.default)) {
      diagnostics.push({
        severity: "error",
        code: "sandbox_export_invalid",
        message: `${path.basename(sourceRef.absolutePath)} must default-export defineSandbox({})`,
        path: sourceRef.absolutePath
      });
      return undefined;
    }
    let totalBytes = 0;
    const workspace = [];
    for (const file of discovered.workspace) {
      const content = await _readSandboxWorkspaceFile(file, workspaceRoot);
      totalBytes += content.byteLength;
      if (content.byteLength > 25 * 1024 * 1024) {
        throw new TypeError(
          `Sandbox workspace file exceeds 25 MiB: ${file.logicalPath}`
        );
      }
      if (totalBytes > 100 * 1024 * 1024) {
        throw new TypeError("Sandbox workspace exceeds 100 MiB");
      }
      const relativePath = file.logicalPath.slice(
        "sandbox/workspace/".length
      );
      const contentBase64 = content.toString("base64");
      const fingerprint = createHash("sha256").update(content).digest("hex");
      sources.push({ id: file.logicalPath, content: contentBase64 });
      workspace.push({
        path: relativePath,
        size: content.byteLength,
        fingerprint,
        contentBase64
      });
    }
    return {
      revalidationFingerprint: createHash("sha256").update(JSON.stringify({
        schemaVersion: 1,
        workspace: workspace.map(file => ({
          fingerprint: file.fingerprint,
          path: file.path,
          size: file.size
        }))
      })).digest("hex"),
      sourcePath: sourceRef.logicalPath,
      workspace
    };
  } catch (error) {
    diagnostics.push({
      severity: "error",
      code: "sandbox_import_failed",
      message: `Unable to import Sandbox definition: ${_errorMessage(error)}`,
      path: sourceRef.absolutePath
    });
    return undefined;
  }
}

async function _readSandboxWorkspaceFile(
  file: AgentProjectSourceRef,
  workspaceRoot: string
): Promise<Buffer> {
  const handle = await open(
    file.absolutePath,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
  );
  try {
    const info = await handle.stat();
    const canonicalPath = await realpath(file.absolutePath);
    const relativePath = path.relative(workspaceRoot, canonicalPath);
    const canonicalInfo = await stat(canonicalPath);
    if (
      relativePath.startsWith(`..${path.sep}`)
      || relativePath === ".."
      || path.isAbsolute(relativePath)
      || !info.isFile()
      || !canonicalInfo.isFile()
      || info.dev !== canonicalInfo.dev
      || info.ino !== canonicalInfo.ino
    ) {
      throw new TypeError(
        `Sandbox workspace entry must remain a regular file: ${file.logicalPath}`
      );
    }
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

async function _compileOutputDefinitions(
  sourceRefs: readonly AgentProjectSourceRef[],
  diagnostics: AgentProjectDiagnostic[],
  dependencies: AgentProjectArtifactDependencyInput[],
  projectRoot: string,
  sources: AgentProjectArtifactSourceInput[]
): Promise<CompiledAgentOutputDefinition[]> {
  const definitions: CompiledAgentOutputDefinition[] = [];
  const names = new Map<string, string>();
  for (const sourceRef of sourceRefs) {
    const name = path.basename(
      sourceRef.absolutePath,
      path.extname(sourceRef.absolutePath)
    );
    if (!isAgentToolName(name) || name === STRUCTURED_OUTPUT_TOOL_NAME) {
      diagnostics.push({
        severity: "error",
        code: "output_export_invalid",
        message: name === STRUCTURED_OUTPUT_TOOL_NAME
          ? `Output name "${name}" is reserved`
          : `Output filename must be a valid model-visible name: ${name}`,
        path: sourceRef.absolutePath
      });
      continue;
    }
    const previous = names.get(name);
    if (previous) {
      diagnostics.push({
        severity: "error",
        code: "output_name_duplicate",
        message: `Output name "${name}" is also exported by ${path.basename(previous)}`,
        path: sourceRef.absolutePath
      });
      continue;
    }
    names.set(name, sourceRef.absolutePath);
    try {
      const loaded = await loadAuthoredModule({
        projectRoot,
        sourcePath: sourceRef.absolutePath,
        authoredSdk: true
      });
      _recordDependencies(dependencies, sourceRef.logicalPath, loaded.dependencies);
      sources.push({ id: sourceRef.logicalPath, content: loaded.source });
      if (!isOutputDefinition(loaded.default)) {
        throw new TypeError(
          `${path.basename(sourceRef.absolutePath)} must default-export defineOutput({ description, schema })`
        );
      }
      definitions.push(compileAgentOutputDefinition(
        loaded.default,
        name,
        sourceRef.logicalPath
      ));
    } catch (error) {
      diagnostics.push({
        severity: "error",
        code: "output_import_failed",
        message: `Unable to import ${path.basename(sourceRef.absolutePath)}: ${_errorMessage(error)}`,
        path: sourceRef.absolutePath
      });
    }
  }
  return definitions;
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
        "agent.ts must default-export defineAgent({ model, modelOptions?, reasoning?, environment?, limits? })"
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
): Promise<{
  dynamicToolResolvers: CompiledDynamicToolResolver[];
  tools: CompiledProjectTool[];
}> {
  const tools: CompiledProjectTool[] = [];
  const dynamicToolResolvers: CompiledDynamicToolResolver[] = [];
  const names = new Map<string, string>();
  for (const sourceRef of sourceRefs) {
    try {
      const loaded = await loadAuthoredModule({
        projectRoot,
        sourcePath: sourceRef.absolutePath,
        authoredSdk: true,
        transformDynamicTools: true
      });
      _recordDependencies(
        dependencies,
        sourceRef.logicalPath,
        loaded.dependencies
      );
      sources.push({ id: sourceRef.logicalPath, content: loaded.source });
      const definition = loaded.default;
      if (isDynamicToolsDefinition(definition)) {
        assertDynamicToolSource(loaded.source, sourceRef.logicalPath);
        dynamicToolResolvers.push({
          contributionId: `tool-resolver:${sourceRef.logicalPath}`,
          definition,
          sourcePath: sourceRef.logicalPath,
          steps: loaded.dynamicToolSteps ?? {}
        });
        continue;
      }
      const name = path.basename(
        sourceRef.absolutePath,
        path.extname(sourceRef.absolutePath)
      );
      if (isExecutionEnvToolDefinition(definition)) {
        if (name !== definition.kind) {
          diagnostics.push({
            severity: "error",
            code: "tool_export_invalid",
            message: `${path.basename(sourceRef.absolutePath)} must be named ${definition.kind}.ts or ${definition.kind}.js`,
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
        tools.push(createCompiledExecutionEnvTool(
          definition.kind,
          sourceRef.logicalPath,
          definition.approval
        ));
        continue;
      }
      if (!isToolDefinition(definition)) {
        diagnostics.push({
          severity: "error",
          code: "tool_export_invalid",
          message: `${path.basename(sourceRef.absolutePath)} must default-export defineTool(...), defineDynamic(...), or its matching ExecutionEnv helper`,
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
      if (!isAgentToolName(name)) {
        diagnostics.push({
          severity: "error",
          code: "tool_export_invalid",
          message: `Tool filename must be a valid model-visible name: ${name}`,
          path: sourceRef.absolutePath
        });
        continue;
      }
      if (name === STRUCTURED_OUTPUT_TOOL_NAME) {
        diagnostics.push({
          severity: "error",
          code: "tool_export_invalid",
          message: `Tool name "${name}" is reserved for structured output`,
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
      tools.push(createCompiledProjectTool({
        definition,
        name,
        sourcePath: sourceRef.logicalPath,
        getSession: () => getActiveAgentSessionContextRuntime() as
          AgentSessionContext
      }));
    } catch (error) {
      diagnostics.push({
        severity: "error",
        code: "tool_import_failed",
        message: `Unable to import ${path.basename(sourceRef.absolutePath)}: ${_errorMessage(error)}`,
        path: sourceRef.absolutePath
      });
    }
  }
  return { dynamicToolResolvers, tools };
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
    if (!isAgentToolName(name)) {
      diagnostics.push({
        severity: "error",
        code: "connection_name_invalid",
        message: `Connection filename must be a valid model-visible name: ${name}`,
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
        if (!isAgentToolName(toolName)) {
          throw new TypeError(`Invalid allowlisted MCP tool name: ${toolName}`);
        }
        const qualifiedName = qualifyProjectMcpToolName(name, toolName);
        if (!isAgentToolName(qualifiedName)) {
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


function _errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
