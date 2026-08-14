import path from "node:path";

import type { Models, Tool as PiTool } from "@earendil-works/pi-ai";
import type {
  PiAcpSessionBackend,
  PiAcpStepRequest,
  PiAcpContinueRequest,
} from "@llm-space/acp";
import type { ToolContext, ToolDefinition } from "@llm-space/agent/tools";
import type { BuiltinTool, McpTool, ToolCallOutput } from "@llm-space/core";
import {
  BunSqliteRuntimeBindingStore,
  BunSqliteSessionRepository,
  PiAssistantExecutor,
  StudioPiSessionRuntime,
  runtimeTool,
  type PiProviderConnection,
  type RuntimeBinding,
  type RuntimeTool,
} from "@llm-space/pi-runtime";
import type { RuntimeClient } from "@llm-space/runtime/runtime";
import {
  assertPiPromptMatchesCoreUserMessage,
  createPlaygroundApplication,
  type PlaygroundApplication,
} from "@llm-space/studio";
import type { StudioStore } from "@llm-space/studio/storage";
import { createSqliteStudioStore } from "@llm-space/studio/storage/sqlite";

export interface CreatePlaygroundHostOptions {
  readonly homePath: string;
  readonly models: Models | (() => Models | Promise<Models>);
  readonly resolveConnection?: (input: {
    readonly operationId: string;
    readonly providerId: string;
    readonly signal: AbortSignal;
  }) => PiProviderConnection | Promise<PiProviderConnection>;
  readonly runtime: RuntimeClient;
}

export interface PlaygroundHost extends PlaygroundApplication {
  readonly acpBackend: PiAcpSessionBackend;
  dispose(): Promise<void>;
}

/** Composes Studio metadata, Pi Session, and bindings over one SQLite file. */
export function createPlaygroundHost(
  options: CreatePlaygroundHostOptions
): PlaygroundHost {
  const databasePath = path.join(options.homePath, "studio", "studio.sqlite");
  const repository = new BunSqliteSessionRepository({ path: databasePath });
  let bindings: BunSqliteRuntimeBindingStore;
  try {
    bindings = new BunSqliteRuntimeBindingStore({ path: databasePath });
  } catch (error) {
    void repository.close();
    throw error;
  }

  const resolveTools = (binding: RuntimeBinding) =>
    _resolveRuntimeTools(binding, options);
  const assistantExecutor = new PiAssistantExecutor({
    models: options.models,
    resolveConnection: options.resolveConnection,
    resolveTools: (binding) => _modelTools(binding),
  });
  const runtime = new StudioPiSessionRuntime({
    repository,
    bindings,
    assistantExecutor,
    resolveTools,
    createToolContext: ({ execution, signal }) =>
      _toolContext(execution, signal),
  });
  let studioStore: ReturnType<typeof createSqliteStudioStore>;
  try {
    studioStore = createSqliteStudioStore({ path: databasePath });
  } catch (error) {
    void runtime.close();
    bindings.close();
    void repository.close();
    throw error;
  }
  const application = createPlaygroundApplication({
    runtime,
    store: studioStore,
  });
  const acpBackend = _acpBackend(application, runtime, studioStore, options);
  const closeApplication = application.close.bind(application);
  let closePromise: Promise<void> | undefined;
  const close = () => {
    closePromise ??= closeApplication().finally(async () => {
      bindings.close();
      await repository.close();
    });
    return closePromise;
  };
  return Object.assign(application, { acpBackend, close, dispose: close });
}

/** Adapts product-owned Playground metadata to the transport-neutral ACP edge. */
function _acpBackend(
  application: PlaygroundApplication,
  runtime: StudioPiSessionRuntime,
  store: StudioStore,
  options: CreatePlaygroundHostOptions
): PiAcpSessionBackend {
  return {
    create: () => runtime.createSession(),
    async list() {
      const playgrounds = await application.listPlaygrounds();
      return {
        sessions: playgrounds.map((playground) => ({
          sessionId: playground.sessionId,
          cwd: path.resolve(options.homePath),
          title: playground.title,
          updatedAt: new Date(playground.updatedAt).toISOString(),
          _meta: { "llm-space.dev": { playgroundId: playground.id } },
        })),
      };
    },
    inspect: (request) => runtime.readCommitted(request),
    async prompt(input) {
      input.signal.throwIfAborted();
      const playground = (await application.listPlaygrounds()).find(
        (candidate) => candidate.sessionId === input.sessionId
      );
      if (playground === undefined) {
        throw new Error(
          `Pi Session "${input.sessionId}" is not owned by a Playground.`
        );
      }
      const metadata = _promptMetadata(input.meta);
      const message = playground.conversation.messages.find(
        (candidate) => candidate.id === metadata.fromMessageId
      );
      if (message?.role !== "user") {
        throw new Error(
          `Playground operation input "${metadata.fromMessageId}" must be a user Message.`
        );
      }
      assertPiPromptMatchesCoreUserMessage(input.messages, message);
      await application.run(playground.id, metadata);
      return runtime.open({
        sessionId: input.sessionId,
        lane: playground.lane,
      });
    },
    step: (input) =>
      _debugCommand(store, runtime, "step", input, async () => {
        const snapshot = await runtime.open(input);
        if (snapshot.operationId === undefined) {
          throw new Error(`Pi Session "${input.sessionId}" has no operation.`);
        }
        await application.stepRun(snapshot.operationId, {
          commandId: input.commandId,
          expectedActionId: input.expectedActionId,
          kind: input.kind,
        });
        return runtime.open(input);
      }),
    continue: (input) =>
      _debugCommand(store, runtime, "continue", input, async () => {
        const snapshot = await runtime.open(input);
        if (snapshot.operationId === undefined) {
          throw new Error(`Pi Session "${input.sessionId}" has no operation.`);
        }
        await application.continueRun(snapshot.operationId);
        return runtime.open(input);
      }),
    async abort(input) {
      const snapshot = await runtime.open(input);
      if (snapshot.operationId === undefined) return snapshot;
      await application.cancelRun(snapshot.operationId);
      return runtime.open(input);
    },
    async closeSession(input) {
      const snapshot = await runtime.open(input);
      if (
        snapshot.nextAction !== undefined ||
        snapshot.status === "suspended"
      ) {
        await runtime.abort(input);
      }
    },
  };
}

/** Durably receipts debugger commands without storing ACP payloads or responses. */
async function _debugCommand(
  store: StudioStore,
  runtime: StudioPiSessionRuntime,
  method: "step" | "continue",
  input: PiAcpStepRequest | PiAcpContinueRequest,
  execute: () => ReturnType<StudioPiSessionRuntime["step"]>
) {
  const fingerprint = JSON.stringify({ method, input });
  const existing = store.transaction((tx) =>
    tx.getCommandReceipt(input.sessionId, input.commandId)
  );
  if (existing !== undefined) {
    if (existing.fingerprint !== fingerprint || existing.method !== method) {
      throw new Error(
        `Command "${input.commandId}" was already used with other input.`
      );
    }
    return runtime.open({
      sessionId: input.sessionId,
      ...(input.lane === undefined ? {} : { lane: input.lane }),
    });
  }
  const snapshot = await execute();
  store.transaction((tx) =>
    tx.insertCommandReceipt({
      sessionId: input.sessionId,
      commandId: input.commandId,
      method,
      fingerprint,
      ...(snapshot.operationId === undefined
        ? {}
        : { operationId: snapshot.operationId }),
      ...(snapshot.leafId === null ? {} : { leafId: snapshot.leafId }),
      createdAt: Date.now(),
    })
  );
  return snapshot;
}

/** Reads LLM Space prompt controls from ACP's reserved implementation metadata. */
function _promptMetadata(meta: Readonly<Record<string, unknown>> | undefined): {
  readonly fromMessageId: string;
  readonly mode: "step" | "continue";
} {
  const value = meta?.["llm-space.dev"];
  if (!_isRecord(value) || typeof value.fromMessageId !== "string") {
    throw new Error(
      "ACP Playground prompt requires llm-space.dev.fromMessageId."
    );
  }
  if (value.mode !== "step" && value.mode !== "continue") {
    throw new Error(
      "ACP Playground prompt requires a valid llm-space.dev.mode."
    );
  }
  return { fromMessageId: value.fromMessageId, mode: value.mode };
}

/** Restores only the tools frozen in the operation's immutable binding. */
async function _resolveRuntimeTools(
  binding: RuntimeBinding,
  options: CreatePlaygroundHostOptions
): Promise<ReadonlyMap<string, RuntimeTool>> {
  const tools = new Map<string, RuntimeTool>();
  const builtins = new Map(
    (await options.runtime.builtInListTools()).map((tool) => [tool.name, tool])
  );
  const mcpResponses = new Map<
    string,
    Awaited<ReturnType<RuntimeClient["mcpListTools"]>>
  >();
  for (const frozen of binding.tools) {
    const tool = await _resolveFrozenTool(
      _toolFromBinding(frozen),
      { builtins, mcpResponses },
      options
    );
    tools.set(
      frozen.name,
      runtimeTool(_definition(tool, options), {
        implementationId: frozen.implementationId,
        ...(tool.type === "mcp"
          ? {
              isErrorResult: (result: unknown) =>
                (result as { isError?: unknown })?.isError === true,
            }
          : {}),
      })
    );
  }
  return tools;
}

/** Projects frozen schemas to Pi without exposing host tool executors. */
function _modelTools(binding: RuntimeBinding): PiTool[] {
  return binding.tools.map((tool) => {
    if (tool.description === undefined || tool.inputSchema === undefined) {
      throw new Error(
        `Frozen tool "${tool.name}" is missing its model-visible schema.`
      );
    }
    return {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema as never,
    };
  });
}

type ExecutableTool = BuiltinTool | McpTool;

interface RuntimeToolIndex {
  readonly builtins: ReadonlyMap<string, BuiltinTool>;
  readonly mcpResponses: Map<
    string,
    Awaited<ReturnType<RuntimeClient["mcpListTools"]>>
  >;
}

/** Decodes the Studio-owned binding needed to resolve one frozen executor. */
function _toolFromBinding(
  modelTool: RuntimeBinding["tools"][number]
): ExecutableTool {
  const hostBinding = modelTool.hostBinding;
  if (hostBinding?.type === "studio.playground-builtin") {
    const config = hostBinding.config;
    if (config !== undefined && !_isRecord(config)) {
      throw new Error(`Frozen built-in tool "${modelTool.name}" is invalid.`);
    }
    return {
      type: "builtin",
      name: modelTool.name,
      description: modelTool.description ?? "",
      parameters: modelTool.inputSchema ?? {},
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
      description: modelTool.description ?? "",
      parameters: modelTool.inputSchema ?? {},
      serverId: hostBinding.serverId,
      serverName: hostBinding.serverName,
      toolName: hostBinding.toolName,
    };
  }
  throw new Error(
    `Playground tool "${modelTool.name}" does not have a durable host binding.`
  );
}

/** Narrows unknown JSON metadata to a plain object. */
function _isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Resolves current host availability while preserving the frozen routing. */
async function _resolveFrozenTool(
  frozen: ExecutableTool,
  index: RuntimeToolIndex,
  options: CreatePlaygroundHostOptions
): Promise<ExecutableTool> {
  if (frozen.type === "builtin") {
    if (index.builtins.get(frozen.name) === undefined) {
      throw new Error(`Built-in tool "${frozen.name}" is unavailable.`);
    }
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

/** Adapts a host RuntimeClient tool to the Pi runtime ToolDefinition seam. */
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

/** Supplies the existing Playground host services to one Pi tool effect. */
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
      throw new Error(
        "Playground approval/auth suspension is not implemented."
      );
    },
  };
}
