import type { AgentDefinition, AgentModelDefinition } from "../agent";
import type {
  AgentManifestSource,
  LoadAgentResult,
} from "../loader";
import type { ToolDefinition } from "../tools";

export type AgentGeneration = Pick<
  LoadAgentResult,
  "diagnostics" | "manifest" | "moduleMap" | "sourceFingerprint"
>;

export interface PreparedTool {
  readonly definition: ToolDefinition;
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
  readonly instructions: readonly string[];
  readonly model: AgentModelDefinition;
  readonly tools: ReadonlyMap<string, PreparedTool>;
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
  if (_asRecordOrEmpty(agent.model).kind === "llm-space:dynamic") {
    throw new AgentGenerationResolutionError(
      "Dynamic model selection is not supported by the Pi runtime."
    );
  }

  const instructions = await Promise.all(
    generation.manifest.instructions.map(async (definition) => {
      if (definition.markdown !== undefined) return definition.markdown;
      if (definition.dynamic === true) {
        throw new AgentGenerationResolutionError(
          `Dynamic instructions from "${definition.logicalPath}" are not supported yet.`
        );
      }
      const value = await _loadDefinition(generation, definition);
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
    if (value.approval !== undefined) {
      throw new AgentGenerationResolutionError(
        `Tool approval for "${source.name}" is not supported by the Pi runtime.`
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

  return {
    agentId: generation.manifest.agentId,
    generationId: generation.sourceFingerprint,
    instructions,
    model: agent.model,
    tools,
  };
}

function _assertSupportedManifestFeatures(generation: AgentGeneration): void {
  const { manifest } = generation;
  const unsupported = [
    ["connections", manifest.connections.length],
    ["hooks", manifest.hooks.length],
    ["skills", manifest.skills.length],
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

function _asRecordOrEmpty(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : {};
}
