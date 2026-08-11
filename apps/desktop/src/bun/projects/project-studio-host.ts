import { loadAgent } from "@llm-space/agent/loader";
import type { ToolContext } from "@llm-space/agent/tools";
import {
  createAgentEngine,
  resolveAgentGeneration,
  type AgentSnapshot,
  type ExecutableAgent,
  type ModelTurnDriver,
} from "@llm-space/engine";
import { createSqliteEngineStore } from "@llm-space/engine/storage/sqlite";
import {
  createStudioApplication,
  type StudioApplication,
} from "@llm-space/studio";
import { createSqliteStudioStore } from "@llm-space/studio/storage/sqlite";

import type { AgentProjectView } from "../../shared/agent-project";
import type { ProjectStudioTransport } from "../../shared/project-studio";

import type { AgentProject } from "./agent-project";
import { GitHeadProvider } from "./git-head-provider";
import { ProjectSandbox } from "./project-sandbox";
import { ProjectSourceFiles } from "./project-source-files";

export interface CreateProjectStudioHostOptions {
  readonly project: AgentProject;
  readonly modelDriver: ModelTurnDriver;
  readonly clock?: () => number;
  readonly generateId?: (prefix: string) => string;
}

export interface ProjectStudioHost extends ProjectStudioTransport {
  readonly project: AgentProjectView;
  close(): Promise<void>;
}

export async function createProjectStudioHost(
  options: CreateProjectStudioHostOptions
): Promise<ProjectStudioHost> {
  const executable = await _loadExecutableAgent(options.project);
  const { snapshot } = executable;
  const sandbox = new ProjectSandbox(options.project.rootPath);
  const engineStore = createSqliteEngineStore({
    path: options.project.databasePath,
  });
  let engine: ReturnType<typeof createAgentEngine>;
  try {
    engine = createAgentEngine({
      store: engineStore,
      modelDriver: options.modelDriver,
      agentResolver: {
        resolve: (storedSnapshot) =>
          _loadExactExecutableAgent(options.project, storedSnapshot),
      },
      createToolContext: ({ execution, signal }) =>
        _studioToolContext({ execution, signal, sandbox }),
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
    studioStore = createSqliteStudioStore({
      path: options.project.databasePath,
    });
  } catch (error) {
    await engine.close();
    throw error;
  }
  const revisionProvider = new GitHeadProvider(options.project.rootPath);
  let runtime: StudioApplication;
  try {
    runtime = createStudioApplication({
      engine,
      store: studioStore,
      revisionProvider,
      resolveCurrentAgent: () => _loadExecutableAgent(options.project),
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
  return new ProjectStudioHostImpl(
    options.project,
    snapshot,
    runtime,
    new ProjectSourceFiles(options.project.rootPath),
    revisionProvider
  );
}

class ProjectStudioHostImpl implements ProjectStudioHost {
  readonly project: AgentProjectView;

  constructor(
    private readonly _agentProject: AgentProject,
    agent: AgentSnapshot,
    private readonly _runtime: StudioApplication,
    private readonly _sourceFiles: ProjectSourceFiles,
    private readonly _revisionProvider: GitHeadProvider
  ) {
    this.project = {
      id: _agentProject.id,
      name: _agentProject.name,
      rootPath: _agentProject.rootPath,
      agentRoot: _agentProject.agentRoot,
      agentId: agent.agentId,
      generationId: agent.generationId,
    };
  }

  getSourceRevision() {
    return this._revisionProvider.current();
  }

  listSourceFiles() {
    return this._sourceFiles.list();
  }

  readSourceFile(path: string) {
    return this._sourceFiles.read(path);
  }

  async *watchSourceFiles(
    input: {
      readonly signal?: AbortSignal;
    } = {}
  ) {
    for await (const files of this._sourceFiles.watch(input)) {
      yield {
        files,
        revision: await this._revisionProvider.current(),
      };
    }
  }

  listThreads() {
    return this._runtime.listThreads();
  }

  listRunHistory(threadId: string) {
    return this._runtime.listRunHistory(threadId);
  }

  saveRunHistory(threadId: string, runIds: readonly string[]) {
    return this._runtime.saveRunHistory(threadId, runIds);
  }

  listEvaluationMetadata(threadId: string) {
    return this._runtime.listEvaluationMetadata(threadId);
  }

  saveEvaluationMetadata(
    threadId: string,
    input: Parameters<StudioApplication["saveEvaluationMetadata"]>[1]
  ) {
    return this._runtime.saveEvaluationMetadata(threadId, input);
  }

  forkThread(threadId: string, input: { readonly checkpointId?: string } = {}) {
    return this._runtime.forkThread(threadId, input);
  }

  async createThread(input: { readonly title?: string } = {}) {
    const commitId = await this._revisionProvider.current();
    const current = await _loadExecutableAgent(this._agentProject);
    return this._runtime.createThread({
      ...input,
      agent: current.snapshot,
      commitId,
    });
  }

  loadThread(threadId: string) {
    return this._runtime.loadThread(threadId);
  }

  saveDocument(
    threadId: string,
    document: Parameters<StudioApplication["saveDocument"]>[1]
  ) {
    return this._runtime.saveDocument(threadId, document);
  }

  run(threadId: string, input: { readonly fromMessageId: string }) {
    return this._runtime.run(threadId, input);
  }

  cancelRun(runId: string) {
    return this._runtime.cancelRun(runId);
  }

  events(
    threadId: string,
    cursor?: Parameters<StudioApplication["events"]>[1]
  ) {
    return this._runtime.events(threadId, {
      ...cursor,
      follow: cursor?.follow ?? true,
    });
  }

  /** Stop Engine work and release this project database's connections. */
  close(): Promise<void> {
    return this._runtime.close();
  }
}

async function _loadExecutableAgent(
  project: AgentProject
): Promise<ExecutableAgent> {
  const definition = await resolveAgentGeneration(
    await loadAgent({ startPath: project.rootPath })
  );
  const currentSnapshot: AgentSnapshot = {
    schemaVersion: 1,
    agentId: definition.agentId,
    generationId: definition.generationId,
    model: definition.model,
    instructions: definition.instructions,
    tools: [...definition.tools.values()].map((tool) => tool.model),
  };
  return {
    snapshot: currentSnapshot,
    tools: definition.tools,
  };
}

async function _loadExactExecutableAgent(
  project: AgentProject,
  storedSnapshot: AgentSnapshot
): Promise<ExecutableAgent> {
  const current = await _loadExecutableAgent(project);
  if (
    current.snapshot.agentId !== storedSnapshot.agentId ||
    current.snapshot.generationId !== storedSnapshot.generationId
  ) {
    throw new Error(
      `Agent generation "${storedSnapshot.agentId}/${storedSnapshot.generationId}" is unavailable.`
    );
  }
  return current;
}

function _studioToolContext(input: {
  readonly execution: ToolContext["execution"];
  readonly signal: AbortSignal;
  readonly sandbox: ProjectSandbox;
}): ToolContext {
  return {
    execution: input.execution,
    abortSignal: input.signal,
    getSandbox: () => Promise.resolve(input.sandbox),
    getSkill(identifier: string) {
      throw new Error(`This Studio host cannot resolve skill "${identifier}".`);
    },
    getToken() {
      return Promise.reject(
        new Error("This Studio host does not provide connection tokens.")
      );
    },
    requireAuth() {
      throw new Error("This Studio host cannot request authorization.");
    },
  };
}
