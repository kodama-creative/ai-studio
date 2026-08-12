import path from "node:path";

import type { ToolContext, ToolDefinition } from "@llm-space/agent/tools";
import type {
  BuiltinTool,
  McpTool,
  PluginTool,
  ToolCallOutput,
} from "@llm-space/core";
import {
  createAgentEngine,
  type AgentSnapshot,
  type ExecutableAgent,
  type PreparedTool,
  type RunExecutor,
} from "@llm-space/engine";
import { createSqliteEngineStore } from "@llm-space/engine/storage/sqlite";
import type { PluginManager } from "@llm-space/runtime/plugins";
import type { RuntimeClient } from "@llm-space/runtime/runtime";
import {
  createPlaygroundApplication,
  type PlaygroundApplication,
} from "@llm-space/studio";
import { createSqliteStudioStore } from "@llm-space/studio/storage/sqlite";

export interface CreatePlaygroundHostOptions {
  readonly homePath: string;
  readonly runExecutor: RunExecutor;
  readonly runtime: RuntimeClient;
  readonly pluginManager: PluginManager;
}

export interface PlaygroundHost extends PlaygroundApplication {}

/** Compose the main-window Playground application over one user-level SQLite. */
export function createPlaygroundHost(
  options: CreatePlaygroundHostOptions
): PlaygroundHost {
  const databasePath = path.join(options.homePath, "studio", "studio.sqlite");
  const engineStore = createSqliteEngineStore({ path: databasePath });
  let engine: ReturnType<typeof createAgentEngine>;
  try {
    engine = createAgentEngine({
      store: engineStore,
      runExecutor: options.runExecutor,
      agentResolver: {
        resolve: (snapshot) => _resolveAgent(snapshot, options),
      },
      createToolContext: ({ execution, signal }) =>
        _toolContext(execution, signal),
    });
  } catch (error) {
    engineStore.close();
    throw error;
  }
  let studioStore: ReturnType<typeof createSqliteStudioStore>;
  try {
    studioStore = createSqliteStudioStore({ path: databasePath });
  } catch (error) {
    void engine.close();
    throw error;
  }
  return createPlaygroundApplication({ engine, store: studioStore });
}

async function _resolveAgent(
  snapshot: AgentSnapshot,
  options: CreatePlaygroundHostOptions
): Promise<ExecutableAgent> {
  const tools = new Map<string, PreparedTool>();
  for (const tool of await _runtimeTools(options)) {
    if (!snapshot.tools.some((candidate) => candidate.name === tool.name)) {
      continue;
    }
    tools.set(tool.name, { definition: _definition(tool, options) });
  }
  return { snapshot, tools };
}

type ExecutableTool = BuiltinTool | McpTool | PluginTool;

async function _runtimeTools(
  options: CreatePlaygroundHostOptions
): Promise<ExecutableTool[]> {
  return [
    ...(await options.runtime.builtInListTools()),
    ...options.pluginManager.tools.list(),
  ];
}

function _definition(
  tool: ExecutableTool,
  options: CreatePlaygroundHostOptions
): ToolDefinition {
  return {
    description: tool.description,
    inputSchema: tool.parameters as never,
    async execute(args) {
      const input = args as Record<string, unknown>;
      if (tool.type === "builtin") {
        return options.runtime.builtInCallTool({
          name: tool.name,
          arguments: input,
          config: tool.config,
        });
      }
      if (tool.type === "mcp") {
        return options.runtime.mcpCallTool({
          serverId: tool.serverId,
          toolName: tool.toolName,
          arguments: input,
        });
      }
      throw new Error(
        `Plugin tool "${tool.name}" is unavailable in Engine Playgrounds because its durable ToolContext adapter is not implemented.`
      );
    },
    toModelOutput: (rawResult) => {
      const result = rawResult as { content: ToolCallOutput["content"] };
      return {
      type: "content",
      value: result.content.map((content) =>
        content.type === "text"
          ? content
          : {
              type: "file" as const,
              data: { type: "data" as const, data: content.data },
              mediaType: content.mimeType,
            }
      ),
      };
    },
  };
}

function _toolContext(
  execution: ToolContext["execution"],
  signal: AbortSignal
): ToolContext {
  return {
    execution,
    abortSignal: signal,
    getSandbox() {
      throw new Error("Playground tools do not provide a code sandbox yet.");
    },
    getSkill(identifier: string) {
      throw new Error(`Playground skill "${identifier}" is unavailable.`);
    },
    getToken() {
      return Promise.reject(new Error("Playground auth is unavailable."));
    },
    requireAuth() {
      throw new Error("Playground approval/auth suspension is not implemented.");
    },
  };
}
