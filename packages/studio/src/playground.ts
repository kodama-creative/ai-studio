import type {
  JsonObject,
  JsonValue,
  ModelConfig,
  Thread,
  Tool,
} from "@llm-space/core";

import type {
  StudioAgentSnapshot,
  StudioConversation,
  StudioOperationReference,
  StudioPiIdentity,
  StudioToolSnapshot,
} from "./pi-domain";

/** Serializable Agent declaration authored by the ordinary Studio Playground. */
export interface AgentSpec {
  readonly schemaVersion: 1;
  readonly model?: ModelConfig;
  readonly instructions: readonly string[];
  readonly tools: readonly Tool[];
  readonly variables?: NonNullable<Thread["context"]>["variables"];
  readonly variableVariants?: NonNullable<
    Thread["context"]
  >["variableVariants"];
}

/** Ordinary Studio workbench metadata projected over one Pi Session. */
export interface Playground extends StudioPiIdentity {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly title: string;
  readonly agentSpec: AgentSpec;
  /** Editable view: dirty Draft when present, otherwise the Pi projection. */
  readonly conversation: StudioConversation;
  readonly dirty: boolean;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface PlaygroundRecord {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly title: string;
  readonly sessionId: string;
  readonly lane: "main";
  readonly runtimeFormatVersion: 1;
  readonly agentSpec: AgentSpec;
  readonly draft?: StudioConversation;
  readonly state: StudioConversation["state"];
  readonly operationReferences: readonly StudioOperationReference[];
  readonly createdAt: number;
  readonly updatedAt: number;
}

/** Convert the editable declaration into product metadata frozen on a Pi operation. */
export function agentSpecSnapshot(
  playgroundId: string,
  spec: AgentSpec
): StudioAgentSnapshot {
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
      `Playground "${playgroundId}" uses tools that the Pi runtime cannot execute: ${unsupported
        .map((tool) =>
          tool.type === "provider-hosted" ? tool.config.type : tool.name
        )
        .join(", ")}.`
    );
  }
  const tools = spec.tools.flatMap(_runtimeTool);
  return {
    agentSpecId: `playground:${playgroundId}`,
    sourceRevision: _fingerprint(spec),
    model: `${spec.model.provider}/${spec.model.id}`,
    instructions: [...spec.instructions],
    tools,
  };
}

function _runtimeTool(tool: Tool): StudioToolSnapshot[] {
  if (tool.type !== "builtin" && tool.type !== "mcp") return [];
  const implementation =
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
        };
  return [
    {
      name: tool.name,
      description: tool.description,
      inputSchema: tool.parameters as Readonly<Record<string, unknown>>,
      implementationId: _fingerprint(implementation),
      replay: "never",
      hostBinding: implementation,
    },
  ];
}

/** Small deterministic content fingerprint; no runtime-specific crypto import. */
function _fingerprint(value: unknown): string {
  const source = JSON.stringify(value) ?? "undefined";
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, "0")}`;
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
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
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
