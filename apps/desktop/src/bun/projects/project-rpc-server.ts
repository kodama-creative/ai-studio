import type { RpcServer } from "../../shared/namespaced-rpc";
import {
  PROJECT_SOURCE_RPC,
  type ProjectSourceRpc,
  type ProjectSourceTransport,
} from "../../shared/project-source-rpc";
import {
  STUDIO_RPC,
  type StudioRpc,
  type StudioTransport,
} from "../../shared/studio-rpc";

/** Project source adapter; no Thread metadata or execution crosses this seam. */
export class ProjectSourceRpcServer implements RpcServer<ProjectSourceRpc> {
  readonly namespace = PROJECT_SOURCE_RPC;
  readonly requests: ProjectSourceRpc["requests"];
  readonly streams: ProjectSourceRpc["streams"];

  constructor(source: ProjectSourceTransport) {
    this.requests = { readSourceFile: (path) => source.readSourceFile(path) };
    this.streams = {
      watchSourceFiles: (input) => source.watchSourceFiles(input),
    };
  }
}

/** Studio metadata adapter; Prompt/Step/Turn/Continue stay in `acpSession.*`. */
export class StudioRpcServer implements RpcServer<StudioRpc> {
  readonly namespace = STUDIO_RPC;
  readonly requests: StudioRpc["requests"];
  readonly streams: StudioRpc["streams"];

  constructor(studio: StudioTransport) {
    this.requests = {
      listThreads: () => studio.listThreads(),
      listRunHistory: (threadId) => studio.listRunHistory(threadId),
      saveRunHistory: (threadId, operationIds) =>
        studio.saveRunHistory(threadId, operationIds),
      listEvaluationMetadata: (threadId) =>
        studio.listEvaluationMetadata(threadId),
      saveEvaluationMetadata: (threadId, input) =>
        studio.saveEvaluationMetadata(threadId, input),
      forkThread: (threadId, input) => studio.forkThread(threadId, input),
      createThread: (input) => studio.createThread(input),
      loadThread: (threadId) => studio.loadThread(threadId),
      saveDocument: (threadId, document) =>
        studio.saveDocument(threadId, document),
    };
    this.streams = {
      events: (threadId, cursor) => studio.events(threadId, cursor),
    };
  }
}
