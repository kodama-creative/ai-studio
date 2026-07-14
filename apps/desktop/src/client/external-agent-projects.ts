import { electrobun } from "@/lib/electrobun";
import type {
  ExternalAgentProjectPreview,
  ExternalAgentProjectSummary,
  ExternalAgentProjectThreadRecord,
  ExternalAgentProjectView,
} from "@/shared/external-agent-project";

function _rpc() {
  if (!electrobun.rpc) throw new Error("Desktop RPC is not initialized.");
  return electrobun.rpc;
}

export const externalAgentProjects = {
  browse(): Promise<ExternalAgentProjectPreview | null> {
    return _rpc().request.externalAgentProjectBrowse({});
  },
  trustAndOpen(path: string): Promise<ExternalAgentProjectView> {
    return _rpc().request.externalAgentProjectTrustAndOpen({ path });
  },
  list(): Promise<ExternalAgentProjectSummary[]> {
    return _rpc().request.externalAgentProjectList({});
  },
  inspect(projectId: string): Promise<ExternalAgentProjectView> {
    return _rpc().request.externalAgentProjectInspect({ projectId });
  },
  remove(projectId: string): Promise<null> {
    return _rpc().request.externalAgentProjectRemove({ projectId });
  },
  refresh(projectId: string): Promise<ExternalAgentProjectView> {
    return _rpc().request.externalAgentProjectRefresh({ projectId });
  },
  createThread(projectId: string, title?: string) {
    return _rpc().request.externalAgentProjectCreateThread({
      projectId,
      title,
    });
  },
  readThread(
    projectId: string,
    threadId: string
  ): Promise<ExternalAgentProjectThreadRecord> {
    return _rpc().request.externalAgentProjectReadThread({
      projectId,
      threadId,
    });
  },
  writeThread(
    projectId: string,
    threadId: string,
    record: ExternalAgentProjectThreadRecord
  ): Promise<null> {
    return _rpc().request.externalAgentProjectWriteThread({
      projectId,
      threadId,
      record,
    });
  },
  duplicateThread(projectId: string, threadId: string) {
    return _rpc().request.externalAgentProjectDuplicateThread({
      projectId,
      threadId,
    });
  },
  deleteThread(projectId: string, threadId: string): Promise<null> {
    return _rpc().request.externalAgentProjectDeleteThread({
      projectId,
      threadId,
    });
  },
  syncThreadFromAgent(
    projectId: string,
    threadId: string
  ): Promise<ExternalAgentProjectThreadRecord> {
    return _rpc().request.externalAgentProjectSyncThreadFromAgent({
      projectId,
      threadId,
    });
  },
  readSource(projectId: string, path: string): Promise<{ text: string }> {
    return _rpc().request.externalAgentProjectReadSource({ projectId, path });
  },
  writeSource(projectId: string, path: string, text: string): Promise<null> {
    return _rpc().request.externalAgentProjectWriteSource({
      projectId,
      path,
      text,
    });
  },
};
