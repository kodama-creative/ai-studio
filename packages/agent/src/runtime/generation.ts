import type { AgentDefinition, AgentModelDefinition } from "../agent";
import type {
  AgentManifestSource,
  LoadAgentResult,
} from "../loader";
import type {
  DynamicResolveContext,
  DynamicSentinel,
} from "../shared/types";
import type { SkillHandle } from "../skills";
import type { ToolDefinition } from "../tools";
import type { VariableDefinition } from "../variables";

import {
  createLoadSkillToolDefinition,
  LOAD_SKILL_TOOL_DESCRIPTION,
  LOAD_SKILL_TOOL_IMPLEMENTATION_ID,
  LOAD_SKILL_TOOL_NAME,
} from "./skill-loader";

const DEFAULT_SKILLS_VARIABLE_NAME = "available_skills";

export type AgentGeneration = Pick<
  LoadAgentResult,
  "diagnostics" | "manifest" | "moduleMap" | "sourceFingerprint"
>;

export interface PreparedTool {
  readonly definition: ToolDefinition;
  readonly implementationId?: string;
  readonly model: {
    readonly name: string;
    readonly description: string;
    readonly inputSchema: Readonly<Record<string, unknown>>;
    readonly outputSchema?: Readonly<Record<string, unknown>>;
  };
}

export interface PreparedAgentDefinition {
  readonly agentId: string;
  readonly generationId: string;
  readonly instructions: readonly PreparedInstructionsDefinition[];
  readonly model: AgentModelDefinition;
  readonly skills: ReadonlyMap<string, PreparedSkillDefinition>;
  readonly skillPaths: ReadonlyMap<string, string>;
  readonly skillsVariable?: VariableDefinition;
  readonly tools: ReadonlyMap<string, PreparedTool>;
}

export type PreparedInstructionsDefinition =
  | string
  | DynamicSentinel<unknown, unknown>;

export type PreparedSkillDefinition =
  | SkillHandle
  | DynamicSentinel<unknown, unknown>;

export interface AgentOperationResolutionInput {
  readonly sessionId: string;
  readonly operationId: string;
  readonly messages: readonly unknown[];
  readonly channel?: DynamicResolveContext["channel"];
}

export interface ResolvedAgentOperationDefinition {
  readonly model: string;
  readonly instructions: readonly string[];
  readonly skills: ReadonlyMap<string, SkillHandle>;
}

export class AgentGenerationResolutionError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AgentGenerationResolutionError";
  }
}

/** Materializes one exact loader generation into data plus executable tools. */
export async function resolveAgentGeneration(
  generation: AgentGeneration
): Promise<PreparedAgentDefinition> {
  const diagnostics = generation.diagnostics.filter(
    (diagnostic) => diagnostic.severity === "error"
  );
  if (diagnostics.length > 0) {
    throw new AgentGenerationResolutionError(
      diagnostics.map((diagnostic) => diagnostic.message).join("\n")
    );
  }

  _assertSupportedManifestFeatures(generation);
  const agent = (
    generation.manifest.agentSource === undefined
      ? generation.manifest.agent
      : _asRecordOrEmpty(
          await _loadDefinition(generation, generation.manifest.agentSource)
        )
  ) as Partial<AgentDefinition>;
  if (agent.model === undefined) {
    throw new AgentGenerationResolutionError(
      `Agent "${generation.manifest.agentId}" does not define a model.`
    );
  }
  const instructions = await Promise.all(
    generation.manifest.instructions.map(async (definition) => {
      if (definition.markdown !== undefined) return definition.markdown;
      const value = await _loadDefinition(generation, definition);
      if (_isDynamic(value)) return value;
      const markdown = _asRecordOrEmpty(value).markdown;
      if (typeof markdown !== "string") {
        throw new AgentGenerationResolutionError(
          `Instructions from "${definition.logicalPath}" do not contain markdown.`
        );
      }
      return markdown;
    })
  );

  const tools = new Map<string, PreparedTool>();
  for (const source of generation.manifest.tools) {
    const value = await _loadDefinition(generation, source);
    if (!_isToolDefinition(value)) {
      throw new AgentGenerationResolutionError(
        `Tool "${source.name}" from "${source.logicalPath}" is not executable.`
      );
    }
    if (tools.has(source.name)) {
      throw new AgentGenerationResolutionError(
        `Agent "${generation.manifest.agentId}" defines multiple tools named "${source.name}".`
      );
    }
    tools.set(source.name, {
      definition: value,
      model: {
        name: source.name,
        description: source.description ?? value.description,
        inputSchema: source.inputSchema ?? {},
        ...(source.outputSchema === undefined
          ? {}
          : { outputSchema: source.outputSchema }),
      },
    });
  }

  const skills = new Map<string, PreparedSkillDefinition>();
  const skillPaths = new Map<string, string>();
  for (const source of generation.manifest.skills) {
    const value =
      source.markdown === undefined
        ? await _loadDefinition(generation, source)
        : {
            name: source.name,
            description: source.description,
            markdown: source.markdown,
          };
    const prepared = _isDynamic(value)
      ? value
      : _skillHandle(source.name, value, source.description);
    if (skills.has(source.name)) {
      throw new AgentGenerationResolutionError(
        `Agent "${generation.manifest.agentId}" defines multiple skills named "${source.name}".`
      );
    }
    skills.set(source.name, prepared);
    skillPaths.set(source.name, source.logicalPath);
  }

  const skillsVariable =
    generation.manifest.skillsVariable === undefined
      ? undefined
      : (_asRecordOrEmpty(
          await _loadDefinition(
            generation,
            generation.manifest.skillsVariable
          )
        ) as unknown as VariableDefinition);

  return {
    agentId: generation.manifest.agentId,
    generationId: generation.sourceFingerprint,
    instructions,
    model: agent.model,
    skills,
    skillPaths,
    ...(skillsVariable === undefined ? {} : { skillsVariable }),
    tools,
  };
}

/** Lets a Studio/App host add framework-owned tools after loading Agent source. */
export function mountAgentFrameworkTools(
  definition: PreparedAgentDefinition
): PreparedAgentDefinition {
  if (definition.skills.size === 0) return definition;
  if (definition.tools.has(LOAD_SKILL_TOOL_NAME)) {
    throw new AgentGenerationResolutionError(
      `Agent "${definition.agentId}" reserves framework tool "${LOAD_SKILL_TOOL_NAME}" when Skills are declared.`
    );
  }
  const loadSkill = createLoadSkillToolDefinition();
  return {
    ...definition,
    tools: new Map(definition.tools).set(LOAD_SKILL_TOOL_NAME, {
      definition: loadSkill,
      implementationId: LOAD_SKILL_TOOL_IMPLEMENTATION_ID,
      model: {
        name: LOAD_SKILL_TOOL_NAME,
        description: LOAD_SKILL_TOOL_DESCRIPTION,
        inputSchema: loadSkill.inputSchema as Readonly<Record<string, unknown>>,
      },
    }),
  };
}

/** Resolves Eve-compatible dynamic model/instructions for one operation only. */
export async function resolveAgentOperation(
  definition: PreparedAgentDefinition,
  input: AgentOperationResolutionInput
): Promise<ResolvedAgentOperationDefinition> {
  const context: DynamicResolveContext = {
    session: { id: input.sessionId },
    channel: input.channel ?? {},
    messages: input.messages,
  };
  const event = {
    type: "turn.started" as const,
    operationId: input.operationId,
  };
  return _resolvePreparedAgent(
    definition,
    (value) => _resolveDynamic(value, event, context),
    input.operationId
  );
}

/** Resolves static values and dynamic fallbacks without running event handlers. */
export function resolveAgentPreview(
  definition: PreparedAgentDefinition
): Promise<ResolvedAgentOperationDefinition> {
  return _resolvePreparedAgent(
    definition,
    (value) => Promise.resolve(_isDynamic(value) ? value.fallback : value),
    "preview"
  );
}

async function _resolvePreparedAgent(
  definition: PreparedAgentDefinition,
  resolve: (value: unknown) => Promise<unknown>,
  operationId: string
): Promise<ResolvedAgentOperationDefinition> {
  const modelValue = await resolve(definition.model);
  const selectedModel = _asRecordOrEmpty(modelValue).model ?? modelValue;
  if (typeof selectedModel !== "string") {
    throw new AgentGenerationResolutionError(
      `Agent "${definition.agentId}" did not resolve a provider/model string for operation "${operationId}".`
    );
  }

  const rawInstructions = await Promise.all(
    definition.instructions.map(async (prepared) => {
      const value = await resolve(prepared);
      const markdown =
        typeof value === "string"
          ? value
          : _asRecordOrEmpty(value).markdown;
      if (typeof markdown !== "string") {
        throw new AgentGenerationResolutionError(
          `Agent "${definition.agentId}" did not resolve instructions for operation "${operationId}".`
        );
      }
      return markdown;
    })
  );
  const skills = new Map<string, SkillHandle>();
  for (const [name, prepared] of definition.skills) {
    skills.set(name, _skillHandle(name, await resolve(prepared)));
  }
  const variable =
    definition.skillsVariable ?? _defaultSkillsVariable(definition.skillPaths);
  let instructions = rawInstructions;
  if (rawInstructions.some((instruction) => _hasVariable(instruction, variable.name))) {
    const variableValue = await variable.resolve({
      skills: [...skills.values()],
    });
    if (typeof variableValue !== "string") {
      throw new AgentGenerationResolutionError(
        `Skills variable "${variable.name}" must resolve to a string.`
      );
    }
    instructions = rawInstructions.map((instruction) =>
      _replaceVariable(instruction, variable.name, variableValue)
    );
  }
  return { model: selectedModel, instructions, skills };
}

function _defaultSkillsVariable(
  skillPaths: ReadonlyMap<string, string>
): VariableDefinition {
  return {
    name: DEFAULT_SKILLS_VARIABLE_NAME,
    resolve({ skills }) {
      if (skills.length === 0) return "";
      return [
        "Available skills",
        "Listed skills are available in this run. Do not claim a listed skill is inaccessible unless activation actually fails.",
        "If the user names a skill or the request clearly matches one of the descriptions below, call load_skill before proceeding.",
        "If multiple skills match, activate the minimal set that covers the task. After activation, follow the returned instructions instead of improvising around them.",
        "If activation fails, say so briefly and continue with the best available alternative.",
        ...skills.map(
          (skill) =>
            `- ${skill.name}: ${_singleLine(skill.description)} (path: ${skillPaths.get(skill.name) ?? `skills/${skill.name}`})`
        ),
      ].join("\n");
    },
  };
}

function _hasVariable(text: string, name: string): boolean {
  return _variablePattern(name).test(text);
}

function _replaceVariable(text: string, name: string, value: string): string {
  return text.replace(_variablePattern(name, "g"), value);
}

function _variablePattern(name: string, flags?: string): RegExp {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\{\\{\\s*${escaped}\\s*\\}\\}`, flags);
}

function _singleLine(value: string): string {
  return value.trim().replace(/\s+/g, " ") || "No description";
}

function _assertSupportedManifestFeatures(generation: AgentGeneration): void {
  const { manifest } = generation;
  const unsupported = [
    ["connections", manifest.connections.length],
    ["hooks", manifest.hooks.length],
    ["subagents", manifest.subagents.length],
    ["sandbox workspace", manifest.sandboxWorkspace.length],
    ["sandbox", manifest.sandbox === undefined ? 0 : 1],
    ["instrumentation", manifest.instrumentation === undefined ? 0 : 1],
  ] as const;
  const active = unsupported
    .filter(([, count]) => count > 0)
    .map(([feature]) => feature);
  if (active.length > 0) {
    throw new AgentGenerationResolutionError(
      `Pi runtime does not yet support: ${active.join(", ")}.`
    );
  }
}

function _skillHandle(
  name: string,
  value: unknown,
  fallbackDescription?: string
): SkillHandle {
  const record = _asRecordOrEmpty(value);
  const description = record.description ?? fallbackDescription;
  const markdown = record.markdown ?? record.instructions;
  if (typeof description !== "string" || typeof markdown !== "string") {
    throw new AgentGenerationResolutionError(
      `Skill "${name}" must resolve a description and markdown.`
    );
  }
  return { name, description, markdown };
}

async function _loadDefinition(
  generation: AgentGeneration,
  source: AgentManifestSource
): Promise<unknown> {
  const nodeId = source.nodeId ?? "$root";
  const node = generation.moduleMap.nodes[nodeId];
  if (node === undefined) {
    throw new AgentGenerationResolutionError(
      `Executable module node "${nodeId}" was not found for "${source.logicalPath}".`
    );
  }
  const qualifiedPrefix = `${nodeId}:`;
  const moduleId = source.sourceId.startsWith(qualifiedPrefix)
    ? source.sourceId.slice(qualifiedPrefix.length)
    : source.sourceId;
  const namespace = node.modules[moduleId];
  if (namespace === undefined) {
    throw new AgentGenerationResolutionError(
      `Executable module "${source.sourceId}" was not found for "${source.logicalPath}".`
    );
  }
  const exportName = source.exportName ?? "default";
  const exported = namespace[exportName];
  if (exported === undefined) {
    throw new AgentGenerationResolutionError(
      `Export "${exportName}" was not found in "${source.logicalPath}".`
    );
  }
  try {
    return typeof exported === "function"
      ? await (exported as () => unknown)()
      : exported;
  } catch (cause) {
    throw new AgentGenerationResolutionError(
      `Failed to materialize "${source.logicalPath}".`,
      { cause }
    );
  }
}

function _isToolDefinition(value: unknown): value is ToolDefinition {
  const record = _asRecordOrEmpty(value);
  return (
    typeof record.description === "string" &&
    typeof record.execute === "function" &&
    typeof record.inputSchema === "object" &&
    record.inputSchema !== null
  );
}

function _isDynamic(value: unknown): value is DynamicSentinel<unknown, unknown> {
  return _asRecordOrEmpty(value).kind === "llm-space:dynamic";
}

async function _resolveDynamic(
  value: unknown,
  event: { readonly type: "turn.started"; readonly operationId: string },
  context: DynamicResolveContext
): Promise<unknown> {
  if (!_isDynamic(value)) return value;
  const handler = value.events["turn.started"];
  const resolved =
    handler === undefined ? undefined : await handler(event, context);
  return resolved === undefined || resolved === null
    ? value.fallback
    : resolved;
}

function _asRecordOrEmpty(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : {};
}
