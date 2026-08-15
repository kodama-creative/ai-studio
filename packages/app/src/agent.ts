import { join } from "node:path";

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Models } from "@earendil-works/pi-ai";
import { loadAgent } from "@llm-space/agent/loader";
import {
  closeRuntimeServices,
  createAgentRuntimeHost,
  LOAD_SKILL_TOOL_IMPLEMENTATION_ID,
  mountAgentFrameworkTools,
  resolveAgentGeneration,
  resolveAgentOperation,
  type PreparedAgentDefinition,
  type RuntimeServices,
} from "@llm-space/agent/runtime";
import {
  BunSqliteRuntimeBindingStore,
  BunSqliteSessionRepository,
  PiAssistantExecutor,
  DurablePiRuntime,
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

/** Project-scoped Pi Session application used by CLI and protocol adapters. */
export interface Agent {
  readonly agentId: string;
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
  readCommitted(
    input: Parameters<SessionApplication["readCommitted"]>[0]
  ): ReturnType<SessionApplication["readCommitted"]>;
  step(
    input: Parameters<SessionApplication["step"]>[0]
  ): ReturnType<SessionApplication["step"]>;
  continue(
    input: Parameters<SessionApplication["continue"]>[0]
  ): ReturnType<SessionApplication["continue"]>;
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
  const host = createAgentRuntimeHost({
    services: options.runtimeServices,
    loadCurrentTools: async () => (await resolveCurrentAgent()).tools,
    wrapFrameworkTool: ({ definition, implementationId }) =>
      runtimeTool(definition, { implementationId }),
  });
  const runtime = new DurablePiRuntime({
    repository,
    bindings,
    assistantExecutor: new PiAssistantExecutor({
      models: options.models,
      ...(options.resolveConnection === undefined
        ? {}
        : { resolveConnection: options.resolveConnection }),
      resolveTools: (binding) => host.modelTools(binding),
    }),
    resolveTools: (binding) => host.resolveTools(binding),
    createToolContext: (input) => host.createToolContext(input),
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
    resolveBinding: async (input) =>
      _operationBinding(await resolveCurrentAgent(), input),
    ...(options.clock === undefined ? {} : { clock: options.clock }),
    ...(options.generateId === undefined
      ? {}
      : { generateId: options.generateId }),
  });
  return new AgentImpl(
    options,
    first.agentId,
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

  readCommitted(
    input: Parameters<SessionApplication["readCommitted"]>[0]
  ): ReturnType<SessionApplication["readCommitted"]> {
    return this._application.readCommitted(input);
  }

  step(
    input: Parameters<SessionApplication["step"]>[0]
  ): ReturnType<SessionApplication["step"]> {
    return this._application.step(input);
  }

  continue(
    input: Parameters<SessionApplication["continue"]>[0]
  ): ReturnType<SessionApplication["continue"]> {
    return this._application.continue(input);
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
  readonly definition: PreparedAgentDefinition;
  readonly bindingTools: RuntimeBinding["tools"];
  readonly tools: ReadonlyMap<string, RuntimeTool>;
}

/** Loads current project source into one immutable Pi operation binding. */
async function _loadExecutable(projectRoot: string): Promise<LoadedExecutable> {
  const definition = mountAgentFrameworkTools(
    await resolveAgentGeneration(await loadAgent({ startPath: projectRoot }))
  );
  const tools = new Map<string, RuntimeTool>();
  const frozenTools = [...definition.tools.entries()].map(([name, tool]) => {
    const implementationId =
      tool.implementationId ?? `source:${definition.generationId}:${name}`;
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
        ...(tool.implementationId === LOAD_SKILL_TOOL_IMPLEMENTATION_ID
          ? { type: "llm-space.agent-load-skill" }
          : {
              type: "app.project-tool",
              agentSpecId: definition.agentId,
              sourceRevision: definition.generationId,
              toolName: name,
            }),
      },
    };
  });
  return {
    agentId: definition.agentId,
    definition,
    bindingTools: frozenTools,
    tools,
  };
}

/** Resolves dynamic Agent configuration once inside DurablePiRuntime.start(). */
async function _operationBinding(
  executable: LoadedExecutable,
  input: {
    readonly sessionId: string;
    readonly operationId: string;
    readonly messages: readonly AgentMessage[];
  }
): Promise<RuntimeBinding> {
  const resolved = await resolveAgentOperation(executable.definition, input);
  const separator = resolved.model.indexOf("/");
  if (separator <= 0 || separator === resolved.model.length - 1) {
    throw new Error(`Pi model "${resolved.model}" must use provider/model format.`);
  }
  return {
    formatVersion: APP_PI_RUNTIME_FORMAT_VERSION,
    agent: {
      agentSpecId: executable.definition.agentId,
      sourceRevision: executable.definition.generationId,
    },
    model: {
      provider: resolved.model.slice(0, separator),
      modelId: resolved.model.slice(separator + 1),
    },
    systemPrompt: resolved.instructions.join("\n\n"),
    skills: [...resolved.skills.values()],
    tools: executable.bindingTools,
  };
}
