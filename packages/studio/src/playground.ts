import type {
  JsonObject,
  JsonValue,
  ModelConfig,
  Thread,
  Tool,
} from "@llm-space/core";
import type {
  AgentSnapshot,
  ModelToolDefinition,
  ThreadState,
} from "@llm-space/engine";

/** Serializable Agent declaration authored by the ordinary Studio Playground. */
export interface AgentSpec {
  readonly schemaVersion: 1;
  readonly model?: ModelConfig;
  readonly instructions: readonly string[];
  readonly tools: readonly Tool[];
  readonly variables?: NonNullable<Thread["context"]>["variables"];
  readonly variableVariants?: NonNullable<Thread["context"]>["variableVariants"];
}

/** Ordinary Studio workbench identity; execution state remains in Engine. */
export interface Playground {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly title: string;
  readonly engineThreadId: string;
  readonly headCheckpointId: string;
  readonly agentSpec: AgentSpec;
  /** Editable view: dirty Draft when present, otherwise Engine head state. */
  readonly conversation: ThreadState;
  readonly dirty: boolean;
  readonly activeRunId?: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface PlaygroundRecord {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly title: string;
  readonly engineThreadId: string;
  readonly agentSpec: AgentSpec;
  readonly draft?: ThreadState;
  readonly createdAt: number;
  readonly updatedAt: number;
}

/** Convert the editable declaration into the immutable shape frozen on a Run. */
export function agentSpecSnapshot(
  playgroundId: string,
  spec: AgentSpec
): AgentSnapshot {
  if (spec.model === undefined) {
    throw new Error(`Playground "${playgroundId}" does not have a model.`);
  }
  const unsupported = spec.tools.filter(
    (tool) =>
      tool.type === "function" ||
      tool.type === "plugin" ||
      tool.type === "provider-hosted"
  );
  if (unsupported.length > 0) {
    throw new Error(
      `Playground "${playgroundId}" uses tools that Engine v1 cannot execute: ${unsupported
        .map((tool) =>
          tool.type === "provider-hosted" ? tool.config.type : tool.name
        )
        .join(", ")}.`
    );
  }
  const tools = spec.tools.flatMap(_modelTool);
  return {
    schemaVersion: 1,
    agentId: `playground:${playgroundId}`,
    generationId: `playground:${playgroundId}`,
    model: `${spec.model.provider}/${spec.model.id}`,
    instructions: [...spec.instructions],
    tools,
  };
}

function _modelTool(tool: Tool): ModelToolDefinition[] {
  if (tool.type !== "builtin" && tool.type !== "mcp") return [];
  return [
    {
      name: tool.name,
      description: tool.description,
      inputSchema: tool.parameters as Readonly<Record<string, unknown>>,
      // A display name is not a durable execution identity. The opaque
      // binding lets a host recover the exact MCP/built-in target after
      // restart without teaching Engine about any Studio tool kind.
      hostBinding:
        tool.type === "mcp"
          ? {
              type: "studio.playground-mcp",
              serverId: tool.serverId,
              serverName: tool.serverName,
              toolName: tool.toolName,
            }
          : {
              type: "studio.playground-builtin",
              ...(tool.config === undefined
                ? {}
                : {
                    config: _cloneJsonObject(
                      tool.config,
                      `Built-in tool "${tool.name}" config`
                    ),
                  }),
            },
    },
  ];
}

/** Reject values SQLite JSON cannot preserve exactly in an immutable Run. */
function _cloneJsonObject(
  value: Readonly<Record<string, unknown>>,
  label: string
): JsonObject {
  const seen = new WeakSet<object>();
  const clone = _cloneJsonValue(value, seen);
  if (
    clone === undefined ||
    clone === null ||
    Array.isArray(clone) ||
    typeof clone !== "object"
  ) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return clone;
}

function _cloneJsonValue(
  value: unknown,
  seen: WeakSet<object>
): JsonValue | undefined {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value !== "object") return undefined;
  if (
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) !== Object.prototype &&
    Object.getPrototypeOf(value) !== null
  ) {
    return undefined;
  }
  if (Object.getOwnPropertySymbols(value).length > 0) return undefined;
  if (seen.has(value)) return undefined;
  seen.add(value);
  if (Array.isArray(value)) {
    const result: JsonValue[] = [];
    for (const item of value) {
      const cloned = _cloneJsonValue(item, seen);
      if (cloned === undefined) return undefined;
      result.push(cloned);
    }
    seen.delete(value);
    return result;
  }
  const result: JsonObject = {};
  for (const [key, item] of Object.entries(value)) {
    const cloned = _cloneJsonValue(item, seen);
    if (cloned === undefined) return undefined;
    result[key] = cloned;
  }
  seen.delete(value);
  return result;
}
