import type { ModelConfig, Thread, Tool } from "@llm-space/core";
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
  return {
    schemaVersion: 1,
    agentId: `playground:${playgroundId}`,
    generationId: `playground:${playgroundId}`,
    model: `${spec.model.provider}/${spec.model.id}`,
    instructions: [...spec.instructions],
    tools: spec.tools.flatMap(_modelTool),
  };
}

function _modelTool(tool: Tool): ModelToolDefinition[] {
  if (tool.type === "provider-hosted") return [];
  return [
    {
      name: tool.name,
      description: tool.description,
      inputSchema: tool.parameters as Readonly<Record<string, unknown>>,
    },
  ];
}
