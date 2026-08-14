import path from "node:path";

import type { ToolContext, ToolDefinition } from "@llm-space/agent/tools";
import type {
  BuiltinTool,
  McpTool,
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
}

export interface PlaygroundHost extends PlaygroundApplication {
  dispose(): Promise<void>;
}

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
  const application = createPlaygroundApplication({
    engine,
    store: studioStore,
  });
  return Object.assign(application, {
    dispose: () => application.close(),
  });
}

async function _resolveAgent(
  snapshot: AgentSnapshot,
  options: CreatePlaygroundHostOptions
): Promise<ExecutableAgent> {
  const tools = new Map<string, PreparedTool>();
  const builtins = new Map(
    (await options.runtime.builtInListTools()).map((tool) => [tool.name, tool])
  );
  const mcpResponses = new Map<
    string,
    Awaited<ReturnType<RuntimeClient["mcpListTools"]>>
  >();

  for (const modelTool of snapshot.tools) {
    const frozen = _frozenTool(modelTool);
    if (frozen === undefined) {
      throw new Error(
        `Playground tool "${modelTool.name}" does not have a durable host binding.`
      );
    }
    const tool = await _resolveFrozenTool(
      frozen,
      { builtins, mcpResponses },
      options
    );
    if (tool.name !== modelTool.name) {
      throw new Error(
        `Playground tool binding resolved "${tool.name}" instead of "${modelTool.name}".`
      );
    }
    tools.set(modelTool.name, {
      definition: _definition(tool, options),
      ...(tool.type === "mcp"
        ? {
            isErrorResult: (result: unknown) =>
              (result as { isError?: unknown })?.isError === true,
          }
        : {}),
    });
  }
  return { snapshot, tools };
}

type ExecutableTool = BuiltinTool | McpTool;

interface RuntimeToolIndex {
  readonly builtins: ReadonlyMap<string, BuiltinTool>;
  readonly mcpResponses: Map<
    string,
    Awaited<ReturnType<RuntimeClient["mcpListTools"]>>
  >;
}

function _frozenTool(
  modelTool: AgentSnapshot["tools"][number]
): ExecutableTool | undefined {
  const { hostBinding } = modelTool;
  if (hostBinding?.type === "studio.playground-builtin") {
    const config = hostBinding.config;
    if (config !== undefined && !_isRecord(config)) return undefined;
    return {
      type: "builtin",
      name: modelTool.name,
      description: modelTool.description,
      parameters: modelTool.inputSchema,
      ...(config === undefined ? {} : { config }),
    };
  }
  if (
    hostBinding?.type === "studio.playground-mcp" &&
    typeof hostBinding.serverId === "string" &&
    typeof hostBinding.serverName === "string" &&
    typeof hostBinding.toolName === "string"
  ) {
    return {
      type: "mcp",
      name: modelTool.name,
      description: modelTool.description,
      parameters: modelTool.inputSchema,
      serverId: hostBinding.serverId,
      serverName: hostBinding.serverName,
      toolName: hostBinding.toolName,
    };
  }
  return undefined;
}

function _isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Resolve only requested MCP servers and verify the frozen routing identity. */
async function _resolveFrozenTool(
  frozen: ExecutableTool,
  index: RuntimeToolIndex,
  options: CreatePlaygroundHostOptions
): Promise<ExecutableTool> {
  if (frozen.type === "builtin") {
    const available = index.builtins.get(frozen.name);
    if (available === undefined) {
      throw new Error(`Built-in tool "${frozen.name}" is unavailable.`);
    }
    // The registry proves availability; config and model metadata remain the
    // exact values frozen into the Run instead of drifting after a restart.
    return frozen;
  }
  let response = index.mcpResponses.get(frozen.serverId);
  if (response === undefined) {
    response = await options.runtime.mcpListTools(frozen.serverId);
    index.mcpResponses.set(frozen.serverId, response);
  }
  const available = response.tools.find(
    (tool) =>
      tool.available &&
      tool.serverId === frozen.serverId &&
      tool.toolName === frozen.toolName &&
      tool.directName === frozen.name
  );
  if (available === undefined) {
    throw new Error(
      `MCP tool "${frozen.serverId}/${frozen.toolName}" is unavailable as "${frozen.name}".`
    );
  }
  return frozen;
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
      return options.runtime.mcpCallTool({
        serverId: tool.serverId,
        toolName: tool.toolName,
        arguments: input,
      });
    },
    toModelOutput: (rawResult) => {
      const result = rawResult as {
        content: ToolCallOutput["content"];
        isError?: boolean;
      };
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
