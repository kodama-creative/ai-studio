import type { ProjectTool, Thread } from "@llm-space/core";
import type { AgentProjectDiagnostic } from "@llm-space/runtime";

import type { SkillInfo } from "./skills";

export type ExternalAgentProjectStatus = "ready" | "invalid" | "missing";

export interface ExternalAgentProjectPreview {
  id: string;
  name: string;
  path: string;
  trusted: boolean;
}

export interface ExternalAgentProjectThreadSummary {
  id: string;
  title: string;
}

export interface ExternalAgentProjectSummary {
  id: string;
  name: string;
  path: string;
  status: ExternalAgentProjectStatus;
  error?: string;
  threads: ExternalAgentProjectThreadSummary[];
}

export interface ExternalAgentProjectView extends ExternalAgentProjectSummary {
  agentPath: string | null;
  instructions: string;
  promptFingerprint: string;
  snapshot: string;
  tools: ProjectTool[];
  skills: SkillInfo[];
  diagnostics: AgentProjectDiagnostic[];
  sourceFiles: string[];
}

export interface ExternalAgentProjectThreadRecord {
  thread: Thread;
  promptFingerprint: string;
  syncedPrompt: string;
}

export interface ExternalAgentProjectChangedPayload {
  projectId: string;
}

export type ExternalAgentProjectRunBlockReason =
  "sourceUnavailable" | "pendingToolResult" | "staleToolSnapshot";

/** A frozen tool step can remain earlier in an edited or reordered Thread. */
export function hasPendingExternalAgentProjectToolResult(
  record: ExternalAgentProjectThreadRecord
): boolean {
  return Boolean(
    record.thread.context?.messages?.some(
      (message) =>
        message.role === "assistant" &&
        message.toolCalls?.some((toolCall) => toolCall.output === undefined)
    )
  );
}

/**
 * Keep manual tool-result completion separate from starting a new model run.
 * A pending call may still execute against its frozen snapshot, but a new run
 * waits until every selected project tool has reconciled to the watched source.
 */
export function getExternalAgentProjectRunBlockReason(
  project: ExternalAgentProjectView,
  record: ExternalAgentProjectThreadRecord
): ExternalAgentProjectRunBlockReason | null {
  if (project.status !== "ready") return "sourceUnavailable";
  if (hasPendingExternalAgentProjectToolResult(record)) {
    return "pendingToolResult";
  }
  const projectTools = (record.thread.context?.tools ?? []).filter(
    (tool): tool is ProjectTool => tool.type === "project"
  );
  if (projectTools.some((tool) => tool.snapshot !== project.snapshot)) {
    return "staleToolSnapshot";
  }
  return null;
}
