import { Compile } from "typebox/compile";

import { compileAgentDefinition } from "./compile-agent-definition";
import { compileAgentStateDefinition } from "./compile-agent-state-definition";
import { normalizeAgentDefinition } from "../../internal/authored-definition/normalize-agent-definition";
import { isDynamicInstructionsDefinition } from "../../internal/authored-instruction-definitions";
import { getActiveAgentSessionContextRuntime } from "../../internal/authored-state-definitions";
import { qualifyProjectMcpToolName } from "../../internal/project-mcp-tool-name";
import { isMcpClientConnectionDefinition } from "../../public/definitions/connections/mcp";
import { isStateDefinition } from "../../public/definitions/state";
import { isToolDefinition } from "../../public/definitions/tool";
import { createImmutableAgentProjectSnapshot } from "../../runtime/agent/create-immutable-agent-project-snapshot";
import { assertRuntimeSessionStateValues } from "../../runtime/harness/in-memory-session-store";

import type { AgentProjectArtifact } from "../../runtime/agent/agent-project-artifact";
import type {
  CompiledAgentInstructionEntry,
  CompiledAgentProjectSnapshot,
  CompiledAgentSkill,
  CompiledAgentStateDefinition,
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
  readonly states: ReadonlyArray<{
    readonly definition: unknown;
    readonly sourcePath: string;
  }>;
  readonly tools: ReadonlyArray<{
    readonly definition: unknown;
    readonly name: string;
    readonly sourcePath: string;
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
  const tools = _compileTools(input.tools);
  const stateDefinitions = _compileStates(input.states);
  const connections = _compileConnections(input.connections, tools);
  return createImmutableAgentProjectSnapshot({
    artifact,
    root: "/opt/llm-space",
    definition,
    instructions: input.instructions,
    instructionEntries,
    tools,
    connections,
    resources: { skills: input.skills },
    stateDefinitions,
    diagnostics: [],
    fingerprint: artifact.fingerprint
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
): CompiledProjectTool[] {
  const names = new Set<string>();
  return inputs.map(input => {
    if (!_isModelName(input.name) || names.has(input.name)) {
      throw new TypeError(`Invalid or duplicate bundled tool name: ${input.name}`);
    }
    names.add(input.name);
    if (!isToolDefinition(input.definition)) {
      throw new TypeError(`Bundled tool is invalid: ${input.name}`);
    }
    const definition = input.definition;
    const inputValidator = Compile(definition.inputSchema);
    const outputValidator = definition.outputSchema
      ? Compile(definition.outputSchema)
      : null;
    return {
      name: input.name,
      label: input.name,
      description: definition.description,
      parameters: definition.inputSchema,
      outputSchema: definition.outputSchema,
      sourcePath: input.sourcePath,
      async execute(toolCallId, value, signal) {
        if (!inputValidator.Check(value)) {
          throw new TypeError(`Invalid input for tool "${input.name}"`);
        }
        const output = await definition.execute(value, {
          abortSignal: signal ?? new AbortController().signal,
          callId: toolCallId,
          toolName: input.name,
          get session() {
            return getActiveAgentSessionContextRuntime() as AgentSessionContext;
          }
        });
        if (outputValidator && !outputValidator.Check(output)) {
          throw new TypeError(`Invalid output from tool "${input.name}"`);
        }
        const text = _serializeToolOutput(output, input.name);
        return {
          content: [{ type: "text" as const, text }],
          details: output
        };
      }
    };
  });
}

function _compileConnections(
  inputs: BundledAgentProjectInput["connections"],
  tools: readonly CompiledProjectTool[]
): CompiledMcpConnection[] {
  const connectionNames = new Set<string>();
  const toolNames = new Set(tools.map(tool => tool.name));
  return inputs.map(input => {
    if (!_isModelName(input.name) || connectionNames.has(input.name)) {
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
      if (!_isModelName(toolName) || !_isModelName(qualifiedName)) {
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
  if (value === null || typeof value === "string" || typeof value === "boolean") {
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
