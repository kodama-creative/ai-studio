import { join } from "node:path";

import type { Models } from "@earendil-works/pi-ai";
import { loadAgent } from "@llm-space/agent/loader";
import type { Message } from "@llm-space/core";
import {
  closeRuntimeServices,
  createAgentEngine,
  createRuntimeToolContext,
  executableAgent,
  resolveAgentGeneration,
  type ExecutableAgent,
  type Run,
  type RunEventCursor,
  type RunFrame,
  type RuntimeServices,
  type ThreadState,
} from "@llm-space/engine";
import { createSqliteEngineStore } from "@llm-space/engine/storage/sqlite";
import {
  createPiRunExecutor,
  type PiProviderConnection,
  type PiProviderConnectionInput,
} from "@llm-space/engine-pi";

import type { Session, SessionMessage, Task } from "./domain";
import {
  createSessionApplication,
  type SessionApplication,
} from "./session-application";
import { createSqliteApplicationStore } from "./storage/sqlite";

export interface CreateAgentOptions {
  /** Source project or built Bundle root understood by the Agent Loader. */
  readonly projectRoot: string;
  /** Host-owned directory; Agent runtime data is never written into source. */
  readonly dataRoot: string;
  /** Pi model registry prepared by the host from its config and credentials. */
  readonly models: Models | (() => Models | Promise<Models>);
  /** Resolve host-owned provider settings without storing secrets in Runs. */
  readonly resolveConnection?: (
    input: PiProviderConnectionInput
  ) => PiProviderConnection | Promise<PiProviderConnection>;
  readonly runtimeServices: RuntimeServices;
  readonly clock?: () => number;
  readonly generateId?: (prefix: string) => string;
}

export interface StartAgentRunInput {
  readonly message: Extract<Message, { role: "user" }>;
  readonly operationId?: string;
  readonly taskId?: string;
}

/** Project-scoped end-application facade over SessionApplication and Engine. */
export interface Agent {
  readonly agentId: string;
  createSession(input?: {
    readonly title?: string;
    readonly projectId?: string;
    readonly initialThreadState?: ThreadState;
  }): Promise<Session>;
  getSession(sessionId: string): Promise<Session | undefined>;
  listSessions(): Promise<readonly Session[]>;
  listMessages(sessionId: string): Promise<readonly SessionMessage[]>;
  createTask(input: {
    readonly sessionId: string;
    readonly title: string;
  }): Promise<Task>;
  listTasks(sessionId: string): Promise<readonly Task[]>;
  listRuns(sessionId: string): Promise<readonly Run[]>;
  startRun(sessionId: string, input: StartAgentRunInput): Promise<Run>;
  retryTaskRun(input: {
    readonly sessionId: string;
    readonly taskId: string;
    readonly runId: string;
    readonly operationId?: string;
  }): Promise<Run>;
  cancelRun(sessionId: string, runId: string): Promise<void>;
  events(
    sessionId: string,
    runId: string,
    cursor?: RunEventCursor
  ): AsyncIterable<RunFrame>;
  close(): Promise<void>;
}

/**
 * Create one project-scoped Agent application.
 *
 * Each new Run reloads current project code. Engine still receives one exact
 * executable snapshot, so code already selected for a running Run is stable.
 */
export async function createAgent(options: CreateAgentOptions): Promise<Agent> {
  const first = await _loadExecutable(options.projectRoot);
  const executableRef = { current: first };
  const databasePath = join(options.dataRoot, "agent.sqlite");
  const engineStore = createSqliteEngineStore({ path: databasePath });
  let engine: ReturnType<typeof createAgentEngine>;
  try {
    engine = createAgentEngine({
      store: engineStore,
      runExecutor: createPiRunExecutor({
        models: options.models,
        ...(options.resolveConnection === undefined
          ? {}
          : { resolveConnection: options.resolveConnection }),
      }),
      agentResolver: {
        async resolve(snapshot) {
          if (_sameSnapshot(executableRef.current, snapshot)) {
            return executableRef.current;
          }
          const loaded = await _loadExecutable(options.projectRoot);
          executableRef.current = loaded;
          return loaded;
        },
      },
      createToolContext: ({ agent, execution, signal }) =>
        createRuntimeToolContext(options.runtimeServices, {
          agentId: agent.agentId,
          execution,
          signal,
        }),
      ...(options.clock === undefined ? {} : { clock: options.clock }),
      ...(options.generateId === undefined
        ? {}
        : { generateId: options.generateId }),
    });
  } catch (error) {
    engineStore.close();
    throw error;
  }
  let store: ReturnType<typeof createSqliteApplicationStore>;
  try {
    store = createSqliteApplicationStore({ path: databasePath });
  } catch (error) {
    await engine.close();
    throw error;
  }
  let application: SessionApplication;
  try {
    application = createSessionApplication({
      engine,
      store,
      ...(options.clock === undefined ? {} : { clock: options.clock }),
      ...(options.generateId === undefined
        ? {}
        : { generateId: options.generateId }),
    });
  } catch (error) {
    store.close();
    await engine.close();
    throw error;
  }
  return new AgentImpl(options, application, first, executableRef);
}

class AgentImpl implements Agent {
  readonly agentId: string;
  private _closed = false;
  private _closePromise: Promise<void> | undefined;

  constructor(
    private readonly _options: CreateAgentOptions,
    private readonly _application: SessionApplication,
    first: ExecutableAgent,
    private readonly _executableRef: { current: ExecutableAgent }
  ) {
    this.agentId = first.snapshot.agentId;
  }

  /** Create a Session whose default continuation Thread is owned by App. */
  createSession(
    input: {
      readonly title?: string;
      readonly projectId?: string;
      readonly initialThreadState?: ThreadState;
    } = {}
  ): Promise<Session> {
    return this._application.createSession({
      ...input,
      agentId: this.agentId,
    });
  }

  getSession(sessionId: string): Promise<Session | undefined> {
    return this._application.getSession(sessionId);
  }

  listSessions(): Promise<readonly Session[]> {
    return this._application.listSessions();
  }

  listMessages(sessionId: string): Promise<readonly SessionMessage[]> {
    return this._application.listMessages(sessionId);
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

  listRuns(sessionId: string): Promise<readonly Run[]> {
    return this._application.listRuns(sessionId);
  }

  /** Reload current Agent code before every user-triggered Run. */
  async startRun(sessionId: string, input: StartAgentRunInput): Promise<Run> {
    const executable = await _loadExecutable(this._options.projectRoot);
    if (executable.snapshot.agentId !== this.agentId) {
      throw new Error(
        `Agent Project changed identity from "${this.agentId}" to "${executable.snapshot.agentId}".`
      );
    }
    this._executableRef.current = executable;
    return this._application.startRun({
      sessionId,
      message: input.message,
      agentSnapshot: executable.snapshot,
      ...(input.taskId === undefined ? {} : { taskId: input.taskId }),
      ...(input.operationId === undefined
        ? {}
        : { operationId: input.operationId }),
    });
  }

  retryTaskRun(input: {
    readonly sessionId: string;
    readonly taskId: string;
    readonly runId: string;
    readonly operationId?: string;
  }): Promise<Run> {
    return this._application.retryTaskRun(input);
  }

  cancelRun(sessionId: string, runId: string): Promise<void> {
    return this._application.cancelRun(sessionId, runId);
  }

  events(
    sessionId: string,
    runId: string,
    cursor?: RunEventCursor
  ): AsyncIterable<RunFrame> {
    return this._application.streamRun(sessionId, runId, cursor);
  }

  close(): Promise<void> {
    this._closePromise ??= this._close();
    return this._closePromise;
  }

  /** Stop durable execution before releasing host runtime services. */
  private async _close(): Promise<void> {
    if (this._closed) return;
    this._closed = true;
    try {
      await this._application.close();
    } finally {
      await closeRuntimeServices(this._options.runtimeServices);
    }
  }
}

/** Resolve one source or Bundle directory into Engine's executable contract. */
async function _loadExecutable(projectRoot: string): Promise<ExecutableAgent> {
  const executable = executableAgent(
    await resolveAgentGeneration(await loadAgent({ startPath: projectRoot }))
  );
  return {
    ...executable,
    // Development has one current source generation. Exact full-snapshot
    // comparison still rejects a paused Run after authored code changes.
    snapshot: { ...executable.snapshot, generationId: "development" },
  };
}

function _sameSnapshot(
  executable: ExecutableAgent,
  snapshot: ExecutableAgent["snapshot"]
): boolean {
  return JSON.stringify(executable.snapshot) === JSON.stringify(snapshot);
}
