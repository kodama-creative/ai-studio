import { join } from "node:path";

import type { Models } from "@earendil-works/pi-ai";
import { loadAgent } from "@llm-space/agent/loader";
import {
  closeRuntimeServices,
  createAgentEngine,
  createRuntimeToolContext,
  resolveAgentGeneration,
  type AgentSnapshot,
  type ExecutableAgent,
  type RuntimeServices,
} from "@llm-space/engine";
import { createSqliteEngineStore } from "@llm-space/engine/storage/sqlite";
import {
  createPiRunExecutor,
  type PiProviderConnection,
  type PiProviderConnectionInput,
} from "@llm-space/engine-pi";

import { GitSourceRevision } from "./git-source-revision";
import {
  ProjectSource,
  type ProjectSourceNode,
  type ProjectSourceSnapshot,
} from "./project-source";
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

/** Project-level Studio facade with source browsing and Experiment execution. */
export interface Studio extends StudioApplication {
  readonly agent: AgentSnapshot;
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

/** Create the complete source-backed Studio runtime for one Agent Project. */
export async function createStudio(
  options: CreateStudioOptions
): Promise<Studio> {
  const revision = new GitSourceRevision(options.projectRoot);
  const first = await _loadExecutable(options.projectRoot);
  const databasePath = join(options.dataRoot, "studio.sqlite");
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
        // Studio has one live development generation. Engine compares the
        // complete returned snapshot with the Run snapshot, so a paused Run
        // still cannot resume after its source changes.
        resolve: () => _loadExecutable(options.projectRoot),
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
  let studioStore: ReturnType<typeof createSqliteStudioStore>;
  try {
    studioStore = createSqliteStudioStore({ path: databasePath });
  } catch (error) {
    await engine.close();
    throw error;
  }
  let application: StudioApplication;
  try {
    application = createStudioApplication({
      engine,
      store: studioStore,
      resolveCurrentAgent: () => _loadExecutable(options.projectRoot),
      ...(options.clock === undefined ? {} : { clock: options.clock }),
      ...(options.generateId === undefined
        ? {}
        : { generateId: options.generateId }),
    });
  } catch (error) {
    studioStore.close();
    await engine.close();
    throw error;
  }
  return new StudioImpl(
    options,
    first.snapshot,
    application,
    revision,
    new ProjectSource(options.projectRoot)
  );
}

class StudioImpl implements Studio {
  private _closePromise: Promise<void> | undefined;

  constructor(
    private readonly _options: CreateStudioOptions,
    readonly agent: AgentSnapshot,
    private readonly _application: StudioApplication,
    private readonly _revision: GitSourceRevision,
    private readonly _source: ProjectSource
  ) {}

  getSourceRevision(): Promise<string> {
    return this._revision.current();
  }

  listSourceFiles(): Promise<readonly ProjectSourceNode[]> {
    return this._source.list();
  }

  readSourceFile(path: string): Promise<string> {
    return this._source.read(path);
  }

  async *watchSourceFiles(
    input: {
      readonly signal?: AbortSignal;
    } = {}
  ): AsyncIterable<ProjectSourceSnapshot> {
    for await (const files of this._source.watch(input)) {
      yield { files, revision: await this._revision.current() };
    }
  }

  listThreads(): ReturnType<StudioApplication["listThreads"]> {
    return this._application.listThreads();
  }

  listRunHistory(
    threadId: string
  ): ReturnType<StudioApplication["listRunHistory"]> {
    return this._application.listRunHistory(threadId);
  }

  saveRunHistory(
    threadId: string,
    runIds: readonly string[]
  ): ReturnType<StudioApplication["saveRunHistory"]> {
    return this._application.saveRunHistory(threadId, runIds);
  }

  listEvaluationMetadata(
    threadId: string
  ): ReturnType<StudioApplication["listEvaluationMetadata"]> {
    return this._application.listEvaluationMetadata(threadId);
  }

  saveEvaluationMetadata(
    threadId: string,
    input: Parameters<StudioApplication["saveEvaluationMetadata"]>[1]
  ): ReturnType<StudioApplication["saveEvaluationMetadata"]> {
    return this._application.saveEvaluationMetadata(threadId, input);
  }

  forkThread(
    threadId: string,
    input: Parameters<StudioApplication["forkThread"]>[1] = {}
  ): ReturnType<StudioApplication["forkThread"]> {
    return this._application.forkThread(threadId, input);
  }

  async createThread(input: { readonly title?: string } = {}) {
    const current = await _loadExecutable(this._options.projectRoot);
    return this._application.createThread({
      ...input,
      agent: current.snapshot,
    });
  }

  loadThread(threadId: string): ReturnType<StudioApplication["loadThread"]> {
    return this._application.loadThread(threadId);
  }

  saveDocument(
    threadId: string,
    document: Parameters<StudioApplication["saveDocument"]>[1]
  ): ReturnType<StudioApplication["saveDocument"]> {
    return this._application.saveDocument(threadId, document);
  }

  run(
    threadId: string,
    input: Parameters<StudioApplication["run"]>[1]
  ): ReturnType<StudioApplication["run"]> {
    return this._application.run(threadId, input);
  }

  stepRun(
    runId: string,
    input: Parameters<StudioApplication["stepRun"]>[1] = {}
  ): ReturnType<StudioApplication["stepRun"]> {
    return this._application.stepRun(runId, input);
  }

  continueRun(runId: string): ReturnType<StudioApplication["continueRun"]> {
    return this._application.continueRun(runId);
  }

  cancelRun(runId: string): ReturnType<StudioApplication["cancelRun"]> {
    return this._application.cancelRun(runId);
  }

  events(
    threadId: string,
    cursor?: Parameters<StudioApplication["events"]>[1]
  ): ReturnType<StudioApplication["events"]> {
    return this._application.events(threadId, {
      ...cursor,
      follow: cursor?.follow ?? true,
    });
  }

  close(): Promise<void> {
    this._closePromise ??= this._close();
    return this._closePromise;
  }

  /** Stop Engine/SQLite before releasing host-provided process services. */
  private async _close(): Promise<void> {
    try {
      await this._application.close();
    } finally {
      await closeRuntimeServices(this._options.runtimeServices);
    }
  }
}

async function _loadExecutable(
  projectRoot: string
): Promise<ExecutableAgent> {
  const definition = await resolveAgentGeneration(
    await loadAgent({ startPath: projectRoot })
  );
  return {
    snapshot: {
      schemaVersion: 1,
      agentId: definition.agentId,
      // The loader fingerprint is only an import-cache key. Development does
      // not expose each edit or Git commit as a durable Agent generation.
      generationId: "development",
      model: definition.model,
      instructions: definition.instructions,
      tools: [...definition.tools.values()].map((tool) => tool.model),
    },
    tools: definition.tools,
  };
}
