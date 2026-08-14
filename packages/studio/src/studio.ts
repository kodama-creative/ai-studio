import { join } from "node:path";

import type { Models, Tool as PiTool } from "@earendil-works/pi-ai";
import type {
  PiAcpContinueRequest,
  PiAcpSessionBackend,
  PiAcpStepRequest,
} from "@llm-space/acp";
import { loadAgent } from "@llm-space/agent/loader";
import {
  closeRuntimeServices,
  createRuntimeToolContext,
  resolveAgentGeneration,
  type RuntimeServices,
} from "@llm-space/engine";
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

import { GitSourceRevision } from "./git-source-revision";
import type { StudioAgentSnapshot, StudioExecutableAgent } from "./pi-domain";
import { assertPiPromptMatchesCoreUserMessage } from "./pi-message-projection";
import {
  ProjectSource,
  type ProjectSourceNode,
  type ProjectSourceSnapshot,
} from "./project-source";
import type { StudioStore } from "./storage";
import { createSqliteStudioStore } from "./storage/sqlite";
import {
  createStudioApplication,
  type StudioApplication,
} from "./studio-application";

export interface CreateStudioOptions {
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

/** Project-level Studio facade with source browsing and Pi Experiment execution. */
export interface Studio extends StudioApplication {
  readonly agent: StudioAgentSnapshot;
  readonly acpBackend: PiAcpSessionBackend;
  getSourceRevision(): Promise<string>;
  listSourceFiles(): Promise<readonly ProjectSourceNode[]>;
  readSourceFile(path: string): Promise<string>;
  watchSourceFiles(input?: {
    readonly signal?: AbortSignal;
  }): AsyncIterable<ProjectSourceSnapshot>;
  createThread(input?: {
    readonly title?: string;
  }): ReturnType<StudioApplication["createThread"]>;
}

/** Creates one source-backed Studio over shared Pi and Studio SQLite tables. */
export async function createStudio(
  options: CreateStudioOptions
): Promise<Studio> {
  const revision = new GitSourceRevision(options.projectRoot);
  const first = await _loadExecutable(options.projectRoot);
  const databasePath = join(options.dataRoot, "studio.sqlite");
  const repository = new BunSqliteSessionRepository({ path: databasePath });
  let bindings: BunSqliteRuntimeBindingStore;
  try {
    bindings = new BunSqliteRuntimeBindingStore({ path: databasePath });
  } catch (error) {
    await repository.close();
    throw error;
  }
  const resolveCurrentAgent = () => _loadExecutable(options.projectRoot);
  const resolveTools = async (): Promise<ReadonlyMap<string, RuntimeTool>> =>
    (await resolveCurrentAgent()).tools;
  const assistantExecutor = new PiAssistantExecutor({
    models: options.models,
    ...(options.resolveConnection === undefined
      ? {}
      : { resolveConnection: options.resolveConnection }),
    resolveTools: _modelTools,
  });
  const runtime = new StudioPiSessionRuntime({
    repository,
    bindings,
    assistantExecutor,
    resolveTools,
    createToolContext: ({ execution, signal }) =>
      createRuntimeToolContext(options.runtimeServices, {
        agentId: first.snapshot.agentSpecId,
        execution,
        signal,
      }),
  });
  let studioStore: ReturnType<typeof createSqliteStudioStore>;
  try {
    studioStore = createSqliteStudioStore({ path: databasePath });
  } catch (error) {
    await runtime.close();
    bindings.close();
    await repository.close();
    throw error;
  }
  const application = createStudioApplication({
    runtime,
    store: studioStore,
    resolveCurrentAgent,
    ...(options.clock === undefined ? {} : { clock: options.clock }),
    ...(options.generateId === undefined
      ? {}
      : { generateId: options.generateId }),
  });
  const acpBackend = _acpBackend(application, runtime, studioStore, options);
  return new StudioImpl(
    options,
    first.snapshot,
    acpBackend,
    application,
    bindings,
    repository,
    revision,
    new ProjectSource(options.projectRoot)
  );
}

class StudioImpl implements Studio {
  private _closePromise: Promise<void> | undefined;

  constructor(
    private readonly _options: CreateStudioOptions,
    readonly agent: StudioAgentSnapshot,
    readonly acpBackend: PiAcpSessionBackend,
    private readonly _application: StudioApplication,
    private readonly _bindings: BunSqliteRuntimeBindingStore,
    private readonly _repository: BunSqliteSessionRepository,
    private readonly _revision: GitSourceRevision,
    private readonly _source: ProjectSource
  ) {}

  /** Returns the current Git/source revision for UI provenance. */
  getSourceRevision(): Promise<string> {
    return this._revision.current();
  }

  /** Lists source files through the project-owned browser. */
  listSourceFiles(): Promise<readonly ProjectSourceNode[]> {
    return this._source.list();
  }

  /** Reads one source file under the Project root. */
  readSourceFile(path: string): Promise<string> {
    return this._source.read(path);
  }

  /** Watches source changes and attaches their current revision. */
  async *watchSourceFiles(
    input: { readonly signal?: AbortSignal } = {}
  ): AsyncIterable<ProjectSourceSnapshot> {
    for await (const files of this._source.watch(input)) {
      yield { files, revision: await this._revision.current() };
    }
  }

  listThreads() {
    return this._application.listThreads();
  }
  listRunHistory(threadId: string) {
    return this._application.listRunHistory(threadId);
  }
  saveRunHistory(threadId: string, operationIds: readonly string[]) {
    return this._application.saveRunHistory(threadId, operationIds);
  }
  listEvaluationMetadata(threadId: string) {
    return this._application.listEvaluationMetadata(threadId);
  }
  saveEvaluationMetadata(
    threadId: string,
    input: Parameters<StudioApplication["saveEvaluationMetadata"]>[1]
  ) {
    return this._application.saveEvaluationMetadata(threadId, input);
  }
  forkThread(
    threadId: string,
    input: Parameters<StudioApplication["forkThread"]>[1] = {}
  ) {
    return this._application.forkThread(threadId, input);
  }

  /** Creates a Pi-backed Experiment from the current source snapshot. */
  async createThread(input: { readonly title?: string } = {}) {
    const current = await _loadExecutable(this._options.projectRoot);
    return this._application.createThread({
      ...input,
      agent: current.snapshot,
    });
  }

  loadThread(threadId: string) {
    return this._application.loadThread(threadId);
  }
  saveDocument(
    threadId: string,
    document: Parameters<StudioApplication["saveDocument"]>[1]
  ) {
    return this._application.saveDocument(threadId, document);
  }
  run(threadId: string, input: Parameters<StudioApplication["run"]>[1]) {
    return this._application.run(threadId, input);
  }
  stepRun(
    operationId: string,
    input: Parameters<StudioApplication["stepRun"]>[1]
  ) {
    return this._application.stepRun(operationId, input);
  }
  continueRun(operationId: string) {
    return this._application.continueRun(operationId);
  }
  cancelRun(operationId: string) {
    return this._application.cancelRun(operationId);
  }
  events(
    threadId: string,
    cursor?: Parameters<StudioApplication["events"]>[1]
  ) {
    return this._application.events(threadId, {
      ...cursor,
      follow: cursor?.follow ?? true,
    });
  }

  /** Closes Studio, bindings, Pi repository, then host runtime services. */
  close(): Promise<void> {
    this._closePromise ??= this._close();
    return this._closePromise;
  }

  private async _close(): Promise<void> {
    try {
      await this._application.close();
    } finally {
      this._bindings.close();
      await this._repository.close();
      await closeRuntimeServices(this._options.runtimeServices);
    }
  }
}

/** Adapts Project Experiment metadata to the transport-neutral ACP edge. */
function _acpBackend(
  application: StudioApplication,
  runtime: StudioPiSessionRuntime,
  store: StudioStore,
  options: CreateStudioOptions
): PiAcpSessionBackend {
  return {
    create: () => runtime.createSession(),
    async list() {
      const threads = await application.listThreads();
      return {
        sessions: threads.map((thread) => ({
          sessionId: thread.sessionId,
          cwd: options.projectRoot,
          title: thread.document.title,
          updatedAt: new Date(thread.updatedAt).toISOString(),
          _meta: { "llm-space.dev": { experimentId: thread.id } },
        })),
      };
    },
    inspect: (request) => runtime.readCommitted(request),
    async prompt(input) {
      input.signal.throwIfAborted();
      const thread = (await application.listThreads()).find(
        (candidate) => candidate.sessionId === input.sessionId
      );
      if (thread === undefined) {
        throw new Error(
          `Pi Session "${input.sessionId}" is not owned by an Experiment.`
        );
      }
      const metadata = _promptMetadata(input.meta);
      const message = thread.document.conversation.messages.find(
        (candidate) => candidate.id === metadata.fromMessageId
      );
      if (message?.role !== "user") {
        throw new Error(
          `Studio operation input "${metadata.fromMessageId}" must be a user Message.`
        );
      }
      assertPiPromptMatchesCoreUserMessage(input.messages, message);
      await application.run(thread.id, metadata);
      return runtime.open({ sessionId: input.sessionId, lane: thread.lane });
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

/** Reads Experiment controls from ACP implementation metadata. */
function _promptMetadata(meta: Readonly<Record<string, unknown>> | undefined): {
  readonly fromMessageId: string;
  readonly mode: "step" | "continue";
  readonly modelOverride?: string;
} {
  const value = meta?.["llm-space.dev"];
  if (!_isRecord(value) || typeof value.fromMessageId !== "string") {
    throw new Error(
      "ACP Experiment prompt requires llm-space.dev.fromMessageId."
    );
  }
  if (value.mode !== "step" && value.mode !== "continue") {
    throw new Error(
      "ACP Experiment prompt requires a valid llm-space.dev.mode."
    );
  }
  return {
    fromMessageId: value.fromMessageId,
    mode: value.mode,
    ...(typeof value.modelOverride === "string"
      ? { modelOverride: value.modelOverride }
      : {}),
  };
}

/** Receipts a debugger command without persisting ACP payload or response data. */
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
    if (existing.method !== method || existing.fingerprint !== fingerprint) {
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

/** Narrows ACP implementation metadata to a plain object. */
function _isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Loads current source into a Pi runtime snapshot and executable tool map. */
async function _loadExecutable(
  projectRoot: string
): Promise<StudioExecutableAgent> {
  const definition = await resolveAgentGeneration(
    await loadAgent({ startPath: projectRoot })
  );
  if (typeof definition.model !== "string") {
    throw new Error(
      `Agent "${definition.agentId}" requires a static provider/model string.`
    );
  }
  const tools = new Map<string, RuntimeTool>();
  const snapshots = [...definition.tools.entries()].map(([name, tool]) => {
    const implementationId = `source:${definition.generationId}:${name}`;
    tools.set(
      name,
      runtimeTool(tool.definition, {
        implementationId,
        ...(tool.isErrorResult === undefined
          ? {}
          : { isErrorResult: tool.isErrorResult }),
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
      replay: "never" as const,
      hostBinding: {
        type: "studio.project-tool",
        agentSpecId: definition.agentId,
        sourceRevision: definition.generationId,
        toolName: name,
      },
    };
  });
  return {
    snapshot: {
      agentSpecId: definition.agentId,
      sourceRevision: definition.generationId,
      model: definition.model,
      instructions: definition.instructions,
      tools: snapshots,
    },
    tools,
  };
}

/** Projects immutable binding schemas to Pi's model-visible Tool contract. */
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
