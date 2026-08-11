import type { AgentModelDefinition } from "@llm-space/agent";
import type { ToolDefinition } from "@llm-space/agent/tools";

export interface ModelToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly outputSchema?: Readonly<Record<string, unknown>>;
}

/** Serializable Agent definition frozen onto every Run. */
export interface AgentSnapshot {
  readonly schemaVersion: 1;
  readonly agentId: string;
  readonly generationId: string;
  readonly model: AgentModelDefinition;
  readonly instructions: readonly string[];
  readonly tools: readonly ModelToolDefinition[];
}

export interface PreparedTool {
  readonly definition: ToolDefinition;
}

export interface ExecutableAgent {
  readonly snapshot: AgentSnapshot;
  readonly tools: ReadonlyMap<string, PreparedTool>;
}

/**
 * Resolves the exact executable generation named by an immutable Run snapshot.
 * Implementations must reject unavailable generations instead of substituting
 * current source code.
 */
export interface AgentResolver {
  resolve(snapshot: AgentSnapshot): Promise<ExecutableAgent>;
}
