import { compileAgentDefinition } from "./compile-agent-definition";
import { compileAgentOutputDefinition } from "./compile-agent-output-definition";
import { compileAgentStateDefinition } from "./compile-agent-state-definition";
import { normalizeAgentDefinition } from "../../internal/authored-definition/normalize-agent-definition";
import { isDynamicToolsDefinition } from "../../internal/authored-dynamic-tools-definition";
import { isDynamicInstructionsDefinition } from "../../internal/authored-instruction-definitions";
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

import type { DynamicToolSteps } from "../../internal/dynamic-tool-step";
import type { AgentProjectArtifact } from "../../runtime/agent/agent-project-artifact";
import type {
  CompiledAgentInstructionEntry,
  CompiledAgentProjectSnapshot,
  CompiledAgentSkill,
  CompiledAgentStateDefinition,
  CompiledDynamicToolResolver,
  CompiledMcpConnection,
  CompiledProjectTool
} from "../../runtime/agent/agent-project-snapshot";
import type { AgentSessionContext } from "../../shared/agent-session-context";

export interface BundledAgentProjectInput {
  readonly connections: ReadonlyArray<{
    readonly definition: unknown;
    readonly logicalPath: string;
    readonly name: string;
  }>;
  readonly definition: unknown;
  readonly instructions: string;
  readonly outputs: ReadonlyArray<{
    readonly definition: unknown;
    readonly name: string;
    readonly sourcePath: string;
  }>;
  readonly instructionEntries: ReadonlyArray<
    | {
      readonly definition: unknown;
      readonly kind: "dynamic";
      readonly sourcePath: string;
    }
    | {
      readonly kind: "static";
      readonly markdown: string;
      readonly sourcePath: string;
    }
  >;
  readonly skills: readonly CompiledAgentSkill[];
  readonly sandbox?: {
    readonly definition: unknown;
    readonly sourcePath: string;
    readonly workspace: NonNullable<CompiledAgentProjectSnapshot["sandbox"]>["workspace"];
  };
  readonly states: ReadonlyArray<{
    readonly definition: unknown;
    readonly sourcePath: string;
  }>;
  readonly tools: ReadonlyArray<{
    readonly definition: unknown;
    readonly kind: "dynamic" | "static";
    readonly name: string;
    readonly sourcePath: string;
    readonly steps?: DynamicToolSteps;
  }>;
}

export function createBundledAgentProject(
  input: BundledAgentProjectInput,
  artifact: AgentProjectArtifact
): CompiledAgentProjectSnapshot {
  const definition = compileAgentDefinition(normalizeAgentDefinition(
    input.definition,
    "Bundled Agent definition is invalid"
  ));
  const instructionEntries: CompiledAgentInstructionEntry[] = input.instructionEntries.map(entry => {
    if (entry.kind === "static") {
      if (typeof entry.markdown !== "string") {
        throw new TypeError(
          `Bundled static instructions are invalid: ${entry.sourcePath}`
        );
      }
      return entry;
    }
    if (!isDynamicInstructionsDefinition(entry.definition)) {
      throw new TypeError(
        `Bundled dynamic instructions are invalid: ${entry.sourcePath}`
      );
    }
    return {
      kind: "dynamic" as const,
      definition: entry.definition,
      sourcePath: entry.sourcePath
    };
  });
  const compiledTools = _compileTools(input.tools);
  const { dynamicToolResolvers, tools } = compiledTools;
  const stateDefinitions = _compileStates(input.states);
  const outputDefinitions = _compileOutputs(input.outputs);
  const sandbox = _compileSandbox(input.sandbox);
  const connections = _compileConnections(input.connections, tools);
  return createImmutableAgentProjectSnapshot({
    artifact,
    root: "/opt/llm-space",
    definition,
    instructions: input.instructions,
    instructionEntries,
    tools,
    dynamicToolResolvers,
    connections,
    resources: { skills: input.skills },
    stateDefinitions,
    outputDefinitions,
    sandbox,
    diagnostics: [],
    fingerprint: artifact.fingerprint
  });
}

function _compileSandbox(
  input: BundledAgentProjectInput["sandbox"]
): CompiledAgentProjectSnapshot["sandbox"] {
  if (!input) { return undefined; }
  if (!isSandboxDefinition(input.definition)) {
    throw new TypeError("Bundled Sandbox definition is invalid");
  }
  return {
    sourcePath: input.sourcePath,
    workspace: input.workspace
  };
}

function _compileOutputs(
  inputs: BundledAgentProjectInput["outputs"]
) {
  const names = new Set<string>();
  return inputs.map(input => {
    if (!isAgentToolName(input.name) || names.has(input.name)) {
      throw new TypeError(`Invalid or duplicate bundled output name: ${input.name}`);
    }
    names.add(input.name);
    if (!isOutputDefinition(input.definition)) {
      throw new TypeError(`Bundled output is invalid: ${input.name}`);
    }
    return compileAgentOutputDefinition(
      input.definition,
      input.name,
      input.sourcePath
    );
  });
}

function _compileStates(
  inputs: BundledAgentProjectInput["states"]
): CompiledAgentStateDefinition[] {
  const names = new Set<string>();
  const definitions = inputs.map(input => {
    if (!isStateDefinition(input.definition)) {
      throw new TypeError(`Bundled state is invalid: ${input.sourcePath}`);
    }
    const definition = input.definition;
    if (names.has(definition.name)) {
      throw new TypeError(`Duplicate bundled state name: ${definition.name}`);
    }
    names.add(definition.name);
    return compileAgentStateDefinition(definition, input.sourcePath);
  });
  assertRuntimeSessionStateValues(Object.fromEntries(
    definitions.map(definition => [definition.name, {
      definitionVersion: definition.version,
      schemaFingerprint: definition.schemaFingerprint,
      value: definition.initial
    }])
  ));
  return definitions;
}

function _compileTools(
  inputs: BundledAgentProjectInput["tools"]
): {
  dynamicToolResolvers: CompiledDynamicToolResolver[];
  tools: CompiledProjectTool[];
} {
  const names = new Set<string>();
  const tools: CompiledProjectTool[] = [];
  const dynamicToolResolvers: CompiledDynamicToolResolver[] = [];
  for (const input of inputs) {
    if (input.kind === "dynamic") {
      if (!isDynamicToolsDefinition(input.definition)) {
        throw new TypeError(`Bundled dynamic tool is invalid: ${input.sourcePath}`);
      }
      dynamicToolResolvers.push({
        contributionId: `tool-resolver:${input.sourcePath}`,
        definition: input.definition,
        sourcePath: input.sourcePath,
        steps: input.steps ?? {}
      });
      continue;
    }
    if (!isAgentToolName(input.name) || names.has(input.name)) {
      throw new TypeError(`Invalid or duplicate bundled tool name: ${input.name}`);
    }
    names.add(input.name);
    if (isExecutionEnvToolDefinition(input.definition)) {
      if (input.name !== input.definition.kind) {
        throw new TypeError(
          `Bundled ExecutionEnv tool ${input.name} must match ${input.definition.kind}`
        );
      }
      tools.push(createCompiledExecutionEnvTool(
        input.definition.kind,
        input.sourcePath,
        input.definition.approval
      ));
      continue;
    }
    if (!isToolDefinition(input.definition)) {
      throw new TypeError(`Bundled tool is invalid: ${input.name}`);
    }
    tools.push(createCompiledProjectTool({
      definition: input.definition,
      name: input.name,
      sourcePath: input.sourcePath,
      getSession: () => getActiveAgentSessionContextRuntime() as
        AgentSessionContext
    }));
  }
  return { dynamicToolResolvers, tools };
}

function _compileConnections(
  inputs: BundledAgentProjectInput["connections"],
  tools: readonly CompiledProjectTool[]
): CompiledMcpConnection[] {
  const connectionNames = new Set<string>();
  const toolNames = new Set(tools.map(tool => tool.name));
  return inputs.map(input => {
    if (!isAgentToolName(input.name) || connectionNames.has(input.name)) {
      throw new TypeError(
        `Invalid or duplicate bundled connection name: ${input.name}`
      );
    }
    connectionNames.add(input.name);
    if (!isMcpClientConnectionDefinition(input.definition)) {
      throw new TypeError(`Bundled connection is invalid: ${input.name}`);
    }
    for (const toolName of input.definition.tools.allow) {
      const qualifiedName = qualifyProjectMcpToolName(input.name, toolName);
      if (!isAgentToolName(toolName) || !isAgentToolName(qualifiedName)) {
        throw new TypeError(`Invalid bundled MCP tool name: ${toolName}`);
      }
      if (toolNames.has(qualifiedName)) {
        throw new TypeError(`Duplicate bundled tool name: ${qualifiedName}`);
      }
      toolNames.add(qualifiedName);
    }
    return {
      name: input.name,
      logicalPath: input.logicalPath,
      definition: input.definition
    };
  });
}
