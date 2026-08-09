import { join } from "node:path";

import { loadAgent } from "@llm-space/agent/loader";
import type { ToolContext } from "@llm-space/agent/tools";
import {
  createModelRunExecutor,
  resolveAgentGeneration,
  type AgentSnapshot,
  type ExecutableAgent,
  type ModelTurnEngine,
} from "@llm-space/harness";
import { createFileStudioStorage } from "@llm-space/harness/storage/file";
import {
  createStudioThreadRuntime,
  type StudioThreadRuntime,
} from "@llm-space/harness/studio";

import type { AgentProjectView } from "../../shared/agent-project";
import type { ProjectStudioTransport } from "../../shared/project-studio";

import type { AgentProject } from "./agent-project";
import { GitHeadProvider } from "./git-head-provider";
import { ProjectSandbox } from "./project-sandbox";
import { ProjectSourceFiles } from "./project-source-files";

export interface CreateProjectStudioHostOptions {
  readonly project: AgentProject;
  readonly engine: ModelTurnEngine;
  readonly clock?: () => number;
  readonly generateId?: (prefix: string) => string;
}

export interface ProjectStudioHost extends ProjectStudioTransport {
  readonly project: AgentProjectView;
}

export async function createProjectStudioHost(
  options: CreateProjectStudioHostOptions
): Promise<ProjectStudioHost> {
  const executable = await _loadExecutableAgent(options.project);
  const { snapshot } = executable;
  const sandbox = new ProjectSandbox(options.project.rootPath);
  const executor = createModelRunExecutor({
    engine: options.engine,
    ...(options.generateId === undefined
      ? {}
      : { generateId: options.generateId }),
    createToolContext: ({ execution, call, modelTurnIndex, signal }) =>
      _studioToolContext({
        execution,
        call,
        modelTurnIndex,
        signal,
        sandbox,
      }),
  });
  const storage = createFileStudioStorage({
    threadsRoot: options.project.threadRoot,
    runsRoot: join(options.project.harnessStateRoot, "runs"),
  });
  const revisionProvider = new GitHeadProvider(options.project.rootPath);
  const runtime = createStudioThreadRuntime({
    ...storage,
    executor,
    revisionProvider,
    resolveAgent: (storedSnapshot) =>
      _loadExecutableAgent(options.project, storedSnapshot),
    resolveCurrentAgent: () => _loadExecutableAgent(options.project),
    ...(options.clock === undefined ? {} : { clock: options.clock }),
    ...(options.generateId === undefined
      ? {}
      : { generateId: options.generateId }),
  });
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
    private readonly _runtime: StudioThreadRuntime,
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
    input: Parameters<StudioThreadRuntime["saveEvaluationMetadata"]>[1]
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
    document: Parameters<StudioThreadRuntime["saveDocument"]>[1]
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
    cursor?: Parameters<StudioThreadRuntime["events"]>[1]
  ) {
    return this._runtime.events(threadId, {
      ...cursor,
      follow: cursor?.follow ?? true,
    });
  }
}

async function _loadExecutableAgent(
  project: AgentProject,
  storedSnapshot?: AgentSnapshot
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
    snapshot: storedSnapshot ?? currentSnapshot,
    tools: definition.tools,
  };
}

function _studioToolContext(input: {
  readonly execution: Parameters<
    NonNullable<
      Parameters<typeof createModelRunExecutor>[0]["createToolContext"]
    >
  >[0]["execution"];
  readonly call: Parameters<
    NonNullable<
      Parameters<typeof createModelRunExecutor>[0]["createToolContext"]
    >
  >[0]["call"];
  readonly modelTurnIndex: number;
  readonly signal: AbortSignal;
  readonly sandbox: ProjectSandbox;
}): ToolContext {
  const threadId =
    input.execution.owner.type === "thread"
      ? input.execution.owner.threadId
      : input.execution.owner.sessionId;
  return {
    abortSignal: input.signal,
    callId: input.call.id,
    toolName: input.call.name,
    session: {
      id: `studio:${threadId}`,
      auth: { current: null, initiator: null },
      turn: {
        id: input.execution.runId,
        sequence: input.modelTurnIndex + 1,
      },
    },
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
