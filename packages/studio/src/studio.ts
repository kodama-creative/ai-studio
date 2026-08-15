import { join } from "node:path";

import type { Models, Tool as PiTool } from "@earendil-works/pi-ai";
import { loadAgent } from "@llm-space/agent/loader";
import {
  closeRuntimeServices,
  createRuntimeToolContext,
  resolveAgentGeneration,
  resolveAgentOperation,
  resolveAgentPreview,
  type RuntimeServices,
} from "@llm-space/agent/runtime";
import type { SkillHandle } from "@llm-space/agent/skills";
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

import { GitSourceRevision } from "./git-source-revision";
import type { StudioAgentSnapshot, StudioExecutableAgent } from "./pi-domain";
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

/** Project-level Studio facade with source browsing and Pi Experiment execution. */
export interface Studio extends StudioApplication {
  readonly agent: StudioAgentSnapshot;
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
  let currentExecutable = first;
  const databasePath = join(options.dataRoot, "studio.sqlite");
  const repository = new BunSqliteSessionRepository({ path: databasePath });
  let bindings: BunSqliteRuntimeBindingStore;
  try {
    bindings = new BunSqliteRuntimeBindingStore({ path: databasePath });
  } catch (error) {
    await repository.close();
    throw error;
  }
  const resolveCurrentAgent = async (input?: {
    readonly sessionId: string;
    readonly operationId: string;
    readonly messages: readonly unknown[];
  }) => {
    const loaded = await _loadExecutable(options.projectRoot, input);
    if (input !== undefined) currentExecutable = loaded;
    return loaded;
  };
  const resolveTools = async (): Promise<ReadonlyMap<string, RuntimeTool>> =>
    (await resolveCurrentAgent()).tools;
  const assistantExecutor = new PiAssistantExecutor({
    models: options.models,
    ...(options.resolveConnection === undefined
      ? {}
      : { resolveConnection: options.resolveConnection }),
    resolveTools: _modelTools,
  });
  const runtime = new DurablePiRuntime({
    repository,
    bindings,
    assistantExecutor,
    resolveTools,
    createToolContext: ({ execution, signal }) =>
      createRuntimeToolContext(
        _withMountedSkills(options.runtimeServices, () => currentExecutable.skills),
        {
        agentId: first.snapshot.agentSpecId,
        execution,
        signal,
        }
      ),
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
  return new StudioImpl(
    options,
    first.snapshot,
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
    threadId: string,
    operationId: string,
    input: Parameters<StudioApplication["stepRun"]>[2]
  ) {
    return this._application.stepRun(threadId, operationId, input);
  }
  continueRun(
    threadId: string,
    operationId: string,
    input: Parameters<StudioApplication["continueRun"]>[2]
  ) {
    return this._application.continueRun(threadId, operationId, input);
  }
  resolveToolApproval(
    threadId: string,
    operationId: string,
    input: Parameters<StudioApplication["resolveToolApproval"]>[2]
  ) {
    return this._application.resolveToolApproval(threadId, operationId, input);
  }
  cancelRun(threadId: string, operationId: string) {
    return this._application.cancelRun(threadId, operationId);
  }
  inspectRun(threadId: string, operationId: string) {
    return this._application.inspectRun(threadId, operationId);
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

/** Loads current source into a Pi runtime snapshot and executable tool map. */
async function _loadExecutable(
  projectRoot: string,
  operation?: {
    readonly sessionId: string;
    readonly operationId: string;
    readonly messages: readonly unknown[];
  }
): Promise<StudioExecutableAgent> {
  const definition = await resolveAgentGeneration(
    await loadAgent({ startPath: projectRoot })
  );
  const resolved =
    operation === undefined
      ? await resolveAgentPreview(definition)
      : await resolveAgentOperation(definition, operation);
  const tools = new Map<string, RuntimeTool>();
  const snapshots = [...definition.tools.entries()].map(([name, tool]) => {
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
      model: resolved.model,
      instructions: resolved.instructions,
      tools: snapshots,
    },
    skills: resolved.skills,
    tools,
  };
}

function _withMountedSkills(
  services: RuntimeServices,
  current: () => ReadonlyMap<string, SkillHandle>
): RuntimeServices {
  return {
    ...services,
    skills: {
      resolve(input) {
        const mounted = current().get(input.identifier);
        if (mounted !== undefined) return mounted;
        if (services.skills !== undefined) return services.skills.resolve(input);
        throw new Error(
          `Agent "${input.agentId}" does not mount Skill "${input.identifier}".`
        );
      },
    },
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
