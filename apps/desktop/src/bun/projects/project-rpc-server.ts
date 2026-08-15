import type { Studio } from "@llm-space/studio/server";

import type { RpcServer } from "../../shared/namespaced-rpc";
import {
  PROJECT_STUDIO_RPC,
  type ProjectStudioRequests,
  type ProjectStudioRpc,
  type ProjectStudioStreams,
} from "../../shared/project-studio";

/** Project-owned RPC adapter; delegates only through the Studio facade. */
export class ProjectRpcServer
  implements
    RpcServer<ProjectStudioRpc>,
    ProjectStudioRequests,
    ProjectStudioStreams
{
  readonly namespace = PROJECT_STUDIO_RPC;
  readonly requests: ProjectStudioRequests = this;
  readonly streams: ProjectStudioStreams = this;

  constructor(private readonly _studio: Studio) {}

  getSourceRevision(): ReturnType<Studio["getSourceRevision"]> {
    return this._studio.getSourceRevision();
  }

  listSourceFiles(): ReturnType<Studio["listSourceFiles"]> {
    return this._studio.listSourceFiles();
  }

  readSourceFile(path: string): ReturnType<Studio["readSourceFile"]> {
    return this._studio.readSourceFile(path);
  }

  watchSourceFiles(
    input: Parameters<Studio["watchSourceFiles"]>[0] = {}
  ): ReturnType<Studio["watchSourceFiles"]> {
    return this._studio.watchSourceFiles(input);
  }

  listThreads(): ReturnType<Studio["listThreads"]> {
    return this._studio.listThreads();
  }

  listRunHistory(threadId: string): ReturnType<Studio["listRunHistory"]> {
    return this._studio.listRunHistory(threadId);
  }

  saveRunHistory(
    threadId: string,
    runIds: readonly string[]
  ): ReturnType<Studio["saveRunHistory"]> {
    return this._studio.saveRunHistory(threadId, runIds);
  }

  listEvaluationMetadata(
    threadId: string
  ): ReturnType<Studio["listEvaluationMetadata"]> {
    return this._studio.listEvaluationMetadata(threadId);
  }

  saveEvaluationMetadata(
    threadId: string,
    input: Parameters<Studio["saveEvaluationMetadata"]>[1]
  ): ReturnType<Studio["saveEvaluationMetadata"]> {
    return this._studio.saveEvaluationMetadata(threadId, input);
  }

  forkThread(
    threadId: string,
    input: Parameters<Studio["forkThread"]>[1] = {}
  ): ReturnType<Studio["forkThread"]> {
    return this._studio.forkThread(threadId, input);
  }

  createThread(
    input: Parameters<Studio["createThread"]>[0] = {}
  ): ReturnType<Studio["createThread"]> {
    return this._studio.createThread(input);
  }

  loadThread(threadId: string): ReturnType<Studio["loadThread"]> {
    return this._studio.loadThread(threadId);
  }

  saveDocument(
    threadId: string,
    document: Parameters<Studio["saveDocument"]>[1]
  ): ReturnType<Studio["saveDocument"]> {
    return this._studio.saveDocument(threadId, document);
  }

  events(
    threadId: string,
    cursor: Parameters<Studio["events"]>[1] = {}
  ): ReturnType<Studio["events"]> {
    return this._studio.events(threadId, cursor);
  }
}
