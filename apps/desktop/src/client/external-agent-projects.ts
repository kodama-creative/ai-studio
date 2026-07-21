import type {
  SandboxAttachmentDescriptor,
  ThreadRuntimeProfileType
} from "@llm-space/core";
import type {
  AgentProjectMcpConnectionPreset,
  AgentProjectPreset
} from "@llm-space/runtime";

import { electrobun } from "@/lib/electrobun";

import type {
  ExternalAgentProjectConnectionActivation,
  ExternalAgentProjectPreview,
  ExternalAgentProjectRuntimeStatus,
  ExternalAgentProjectSummary,
  ExternalAgentProjectThreadRecord,
  ExternalAgentProjectView
} from "@/shared/external-agent-project";

function _rpc() {
  if (!electrobun.rpc) {
    throw new Error("Desktop RPC is not initialized.");
  }
  return electrobun.rpc;
}

export const externalAgentProjects = {
  async browseCreateParent(): Promise<{ path: string; } | null> {
    return _rpc().request.externalAgentProjectBrowseCreateParent({});
  },
  async browse(): Promise<ExternalAgentProjectPreview | null> {
    return _rpc().request.externalAgentProjectBrowse({});
  },
  async trustAndOpen(path: string): Promise<ExternalAgentProjectView> {
    return _rpc().request.externalAgentProjectTrustAndOpen({ path });
  },
  async create(input: {
    mcpConnection?: AgentProjectMcpConnectionPreset;
    name: string;
    parentDirectory: string;
    presets: AgentProjectPreset[];
  }): Promise<ExternalAgentProjectView> {
    return _rpc().request.externalAgentProjectCreate(input);
  },
  async list(): Promise<ExternalAgentProjectSummary[]> {
    return _rpc().request.externalAgentProjectList({});
  },
  async inspect(projectId: string): Promise<ExternalAgentProjectView> {
    return _rpc().request.externalAgentProjectInspect({ projectId });
  },
  async remove(projectId: string): Promise<null> {
    return _rpc().request.externalAgentProjectRemove({ projectId });
  },
  async refresh(projectId: string): Promise<ExternalAgentProjectView> {
    return _rpc().request.externalAgentProjectRefresh({ projectId });
  },
  async createThread(
    projectId: string,
    title?: string,
    runtimeProfileType?: ThreadRuntimeProfileType
  ) {
    return _rpc().request.externalAgentProjectCreateThread({
      projectId,
      ...(title ? { title } : {}),
      ...(runtimeProfileType ? { runtimeProfileType } : {})
    });
  },
  async readThread(
    projectId: string,
    threadId: string
  ): Promise<ExternalAgentProjectThreadRecord> {
    return _rpc().request.externalAgentProjectReadThread({
      projectId,
      threadId
    });
  },
  async runtimeStatus(
    projectId: string,
    threadId: string
  ): Promise<ExternalAgentProjectRuntimeStatus> {
    return _rpc().request.externalAgentProjectRuntimeStatus({
      projectId,
      threadId
    });
  },
  async sandboxStatus(
    threadId: string
  ): Promise<ExternalAgentProjectRuntimeStatus> {
    return _rpc().request.externalAgentProjectSandboxStatus({ threadId });
  },
  async setRuntimeProfile(
    projectId: string,
    threadId: string,
    runtimeProfileType: ThreadRuntimeProfileType
  ): Promise<ExternalAgentProjectThreadRecord> {
    return _rpc().request.externalAgentProjectSetRuntimeProfile({
      projectId,
      runtimeProfileType,
      threadId
    });
  },
  async stageSandboxFiles(
    projectId: string,
    threadId: string,
    messageId: string
  ): Promise<SandboxAttachmentDescriptor[]> {
    return _rpc().request.externalAgentProjectStageSandboxFiles({
      projectId,
      threadId,
      messageId
    });
  },
  async activateConnections(
    projectId: string,
    threadId: string
  ): Promise<ExternalAgentProjectConnectionActivation> {
    return _rpc().request.externalAgentProjectActivateConnections({
      projectId,
      threadId
    });
  },
  async deactivateConnections(projectId: string, threadId: string): Promise<null> {
    return _rpc().request.externalAgentProjectDeactivateConnections({
      projectId,
      threadId
    });
  },
  async writeThread(
    projectId: string,
    threadId: string,
    record: ExternalAgentProjectThreadRecord
  ): Promise<null> {
    return _rpc().request.externalAgentProjectWriteThread({
      projectId,
      threadId,
      record
    });
  },
  async duplicateThread(projectId: string, threadId: string) {
    return _rpc().request.externalAgentProjectDuplicateThread({
      projectId,
      threadId
    });
  },
  async deleteThread(projectId: string, threadId: string): Promise<null> {
    return _rpc().request.externalAgentProjectDeleteThread({
      projectId,
      threadId
    });
  },
  async syncThreadFromAgent(
    projectId: string,
    threadId: string
  ): Promise<ExternalAgentProjectThreadRecord> {
    return _rpc().request.externalAgentProjectSyncThreadFromAgent({
      projectId,
      threadId
    });
  },
  async readSource(projectId: string, path: string): Promise<{ text: string; }> {
    return _rpc().request.externalAgentProjectReadSource({ projectId, path });
  },
  async writeSource(projectId: string, path: string, text: string): Promise<null> {
    return _rpc().request.externalAgentProjectWriteSource({
      projectId,
      path,
      text
    });
  }
};
