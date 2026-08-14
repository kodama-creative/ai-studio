import { join, resolve } from "node:path";

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Models, Tool as PiTool } from "@earendil-works/pi-ai";
import type { PiAcpSessionBackend } from "@llm-space/acp";
import { loadAgent } from "@llm-space/agent/loader";
import {
  closeRuntimeServices,
  createRuntimeToolContext,
  resolveAgentGeneration,
  type RuntimeServices,
} from "@llm-space/agent/runtime";
import {
  BunSqliteRuntimeBindingStore,
  BunSqliteSessionRepository,
  PiAssistantExecutor,
  StudioPiSessionRuntime,
  runtimeTool,
  type PiProviderConnection,
  type PiProviderConnectionInput,
  type RuntimeBinding,
  type RuntimeTool,
} from "@llm-space/pi-runtime";

import {
  APP_PI_RUNTIME_FORMAT_VERSION,
  type AgentExecutionResult,
  type Session,
  type SessionEntry,
  type Task,
} from "./domain";
import {
  createSessionApplication,
  type SessionApplication,
} from "./session-application";
import { createSqliteApplicationStore } from "./storage/sqlite";

export interface CreateAgentOptions {
  readonly projectRoot: string;
  readonly dataRoot: string;
  readonly models: Models | (() => Models | Promise<Models>);
  readonly resolveConnection?: (
    input: PiProviderConnectionInput
  ) => PiProviderConnection | Promise<PiProviderConnection>;
  readonly runtimeServices: RuntimeServices;
  readonly clock?: () => number;
  readonly generateId?: (prefix: string) => string;
}

export interface ExecAgentInput {
  readonly messages: readonly AgentMessage[];
  readonly operationId?: string;
  readonly taskId?: string;
  readonly mode?: "step" | "continue";
  readonly signal?: AbortSignal;
}

/** Project-scoped Pi Session application used by CLI and ACP hosts. */
export interface Agent {
  readonly agentId: string;
  readonly acpBackend: PiAcpSessionBackend;
  createSession(input?: {
    readonly sessionId?: string;
    readonly name?: string;
    readonly projectId?: string;
  }): Promise<Session>;
  getSession(sessionId: string): Promise<Session | undefined>;
  listSessions(): Promise<readonly Session[]>;
  listEntries(sessionId: string): Promise<readonly SessionEntry[]>;
  listOperations(
    sessionId: string
  ): ReturnType<SessionApplication["listOperations"]>;
  createTask(input: {
    readonly sessionId: string;
    readonly title: string;
  }): Promise<Task>;
  listTasks(sessionId: string): Promise<readonly Task[]>;
  exec(sessionId: string, input: ExecAgentInput): Promise<AgentExecutionResult>;
  abort(sessionId: string): Promise<void>;
  close(): Promise<void>;
}

/** Composes App metadata, Pi Session, and bindings over one SQLite file. */
export async function createAgent(options: CreateAgentOptions): Promise<Agent> {
  const first = await _loadExecutable(options.projectRoot);
  const databasePath = join(options.dataRoot, "agent.sqlite");
  const repository = new BunSqliteSessionRepository({ path: databasePath });
  let bindings: BunSqliteRuntimeBindingStore;
  try {
    bindings = new BunSqliteRuntimeBindingStore({ path: databasePath });
  } catch (error) {
    await repository.close();
    throw error;
  }
  const resolveCurrentAgent = async () => {
    const current = await _loadExecutable(options.projectRoot);
    if (current.agentId !== first.agentId) {
      throw new Error(
        `Agent identity changed from "${first.agentId}" to "${current.agentId}" while the App was open.`
      );
    }
    return current;
  };
  const resolveTools = async (): Promise<ReadonlyMap<string, RuntimeTool>> =>
    (await resolveCurrentAgent()).tools;
  const runtime = new StudioPiSessionRuntime({
    repository,
    bindings,
    assistantExecutor: new PiAssistantExecutor({
      models: options.models,
      ...(options.resolveConnection === undefined
        ? {}
        : { resolveConnection: options.resolveConnection }),
      resolveTools: _modelTools,
    }),
    resolveTools,
    createToolContext: ({ execution, signal }) =>
      createRuntimeToolContext(options.runtimeServices, {
        agentId: first.agentId,
        execution,
        signal,
      }),
  });
  let store: ReturnType<typeof createSqliteApplicationStore>;
  try {
    store = createSqliteApplicationStore({ path: databasePath });
  } catch (error) {
    try {
      await runtime.close();
    } finally {
      try {
        bindings.close();
      } finally {
        await repository.close();
      }
    }
    throw error;
  }
  const application = createSessionApplication({
    runtime,
    store,
    agentId: first.agentId,
    resolveBinding: async () => (await resolveCurrentAgent()).binding,
    ...(options.clock === undefined ? {} : { clock: options.clock }),
    ...(options.generateId === undefined
      ? {}
      : { generateId: options.generateId }),
  });
  const backend = _acpBackend(application, runtime, options.projectRoot);
  return new AgentImpl(
    options,
    first.agentId,
    backend,
    application,
    bindings,
    repository
  );
}

class AgentImpl implements Agent {
  private _closePromise: Promise<void> | undefined;

  constructor(
    private readonly _options: CreateAgentOptions,
    readonly agentId: string,
    readonly acpBackend: PiAcpSessionBackend,
    private readonly _application: SessionApplication,
    private readonly _bindings: BunSqliteRuntimeBindingStore,
    private readonly _repository: BunSqliteSessionRepository
  ) {}

  createSession(
    input: {
      readonly sessionId?: string;
      readonly name?: string;
      readonly projectId?: string;
    } = {}
  ): Promise<Session> {
    return this._application.createSession(input);
  }

  getSession(sessionId: string): Promise<Session | undefined> {
    return this._application.getSession(sessionId);
  }

  listSessions(): Promise<readonly Session[]> {
    return this._application.listSessions();
  }

  listEntries(sessionId: string): Promise<readonly SessionEntry[]> {
    return this._application.listEntries(sessionId);
  }

  listOperations(
    sessionId: string
  ): ReturnType<SessionApplication["listOperations"]> {
    return this._application.listOperations(sessionId);
  }

  createTask(input: {
    readonly sessionId: string;
    readonly title: string;
  }): Promise<Task> {
    return this._application.createTask(input);
  }

  listTasks(sessionId: string): Promise<readonly Task[]> {
    return this._application.listTasks(sessionId);
  }

  exec(sessionId: string, input: ExecAgentInput): Promise<AgentExecutionResult> {
    return this._application.execute({ sessionId, ...input });
  }

  abort(sessionId: string): Promise<void> {
    return this._application.abort(sessionId);
  }

  close(): Promise<void> {
    this._closePromise ??= this._close();
    return this._closePromise;
  }

  private async _close(): Promise<void> {
    try {
      await this._application.close();
    } finally {
      try {
        this._bindings.close();
      } finally {
        try {
          await this._repository.close();
        } finally {
          await closeRuntimeServices(this._options.runtimeServices);
        }
      }
    }
  }
}

interface LoadedExecutable {
  readonly agentId: string;
  readonly binding: RuntimeBinding;
  readonly tools: ReadonlyMap<string, RuntimeTool>;
}

/** Loads current project source into one immutable Pi operation binding. */
async function _loadExecutable(projectRoot: string): Promise<LoadedExecutable> {
  const definition = await resolveAgentGeneration(
    await loadAgent({ startPath: projectRoot })
  );
  if (typeof definition.model !== "string") {
    throw new Error(
      `Agent "${definition.agentId}" requires a static provider/model string.`
    );
  }
  const separator = definition.model.indexOf("/");
  if (separator <= 0 || separator === definition.model.length - 1) {
    throw new Error(
      `Pi model "${definition.model}" must use provider/model format.`
    );
  }
  const tools = new Map<string, RuntimeTool>();
  const frozenTools = [...definition.tools.entries()].map(([name, tool]) => {
    const implementationId = `source:${definition.generationId}:${name}`;
    tools.set(
      name,
      runtimeTool(tool.definition, {
        implementationId,
      })
    );
    return {
      name,
      description: tool.model.description,
      inputSchema: tool.model.inputSchema,
      ...(tool.model.outputSchema === undefined
        ? {}
        : { outputSchema: tool.model.outputSchema }),
      implementationId,
      replay: tool.definition.replay ?? "never",
      hostBinding: {
        type: "app.project-tool",
        agentSpecId: definition.agentId,
        sourceRevision: definition.generationId,
        toolName: name,
      },
    };
  });
  return {
    agentId: definition.agentId,
    binding: {
      formatVersion: APP_PI_RUNTIME_FORMAT_VERSION,
      agent: {
        agentSpecId: definition.agentId,
        sourceRevision: definition.generationId,
      },
      model: {
        provider: definition.model.slice(0, separator),
        modelId: definition.model.slice(separator + 1),
      },
      systemPrompt: definition.instructions.join("\n\n"),
      tools: frozenTools,
    },
    tools,
  };
}

/** Projects frozen tool schemas to Pi's model-visible contract. */
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

/** Adapts the App facade to the transport-neutral official ACP edge. */
function _acpBackend(
  application: SessionApplication,
  runtime: StudioPiSessionRuntime,
  projectRoot: string
): PiAcpSessionBackend {
  const cwd = resolve(projectRoot);
  return {
    async create(request) {
      if (resolve(request.cwd) !== cwd) {
        throw new Error(`ACP Session cwd must be the Agent Project root: ${cwd}`);
      }
      const session = await application.createSession();
      return runtime.open({ sessionId: session.sessionId, lane: session.lane });
    },
    async list(request) {
      if (request.cursor !== undefined && request.cursor !== null) {
        throw new Error("ACP Session list cursor is invalid for this endpoint.");
      }
      if (
        request.cwd !== undefined &&
        request.cwd !== null &&
        resolve(request.cwd) !== cwd
      ) {
        return { sessions: [] };
      }
      const sessions = await application.listSessions();
      return {
        sessions: sessions.map((session) => ({
          sessionId: session.sessionId,
          cwd,
          title: session.name,
          updatedAt: new Date(session.updatedAt).toISOString(),
        })),
      };
    },
    inspect: (request) => application.readCommitted(request),
    async prompt(input) {
      const controls = input.meta?.["llm-space.dev"];
      const mode =
        typeof controls === "object" &&
        controls !== null &&
        !Array.isArray(controls) &&
        (controls as Record<string, unknown>).mode === "step"
          ? "step"
          : "continue";
      const result = await application.execute({
        sessionId: input.sessionId,
        messages: input.messages,
        mode,
        signal: input.signal,
      });
      return result.snapshot;
    },
    step: (input) => application.step(input),
    continue: (input) => application.continue(input),
    async abort(input) {
      await application.abort(input.sessionId);
      return runtime.open(input);
    },
    async closeSession(input) {
      await application.abort(input.sessionId);
    },
  };
}
