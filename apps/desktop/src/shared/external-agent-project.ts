import type { ProjectTool, Thread } from "@llm-space/core";
import type {
  AgentProjectDiagnostic,
  CompiledAgentDefinition
} from "@llm-space/runtime";

import type { SkillInfo } from "./skills";

export type ExternalAgentProjectStatus = "invalid" | "missing" | "ready";

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
  removable: boolean;
  status: ExternalAgentProjectStatus;
  error?: string;
  threads: ExternalAgentProjectThreadSummary[];
}

export interface ExternalAgentProjectView extends ExternalAgentProjectSummary {
  agentPath: string | null;
  artifactFingerprint: string;
  instructions: string;
  definition: CompiledAgentDefinition | null;
  definitionFingerprint: string;
  promptFingerprint: string;
  snapshot: string;
  tools: ProjectTool[];
  skills: SkillInfo[];
  diagnostics: AgentProjectDiagnostic[];
  sourceFiles: string[];
}

export interface ExternalAgentProjectConnectionStatus {
  connectionName: string;
  description: string;
  sourcePath: string;
  state: "drift" | "ready" | "unavailable";
  message?: string;
  missingTools?: readonly string[];
  toolNames?: readonly string[];
}

export interface ExternalAgentProjectConnectionActivation {
  tools: ProjectTool[];
  statuses: ExternalAgentProjectConnectionStatus[];
  hasSchemaDrift: boolean;
}

export interface ExternalAgentProjectRuntimeStatus {
  message?: string;
  state:
    | "preparing"
    | "ready"
    | "reconnecting"
    | "running"
    | "stale"
    | "unavailable";
}

/** Durable identity written before a remote Project tool call starts. */
export interface RemoteToolCallAttempt {
  readonly messageId: string;
  readonly toolCallId: string;
  readonly at: string;
}

export type ExternalAgentProjectToolCallResponse =
  | { contentText: string; isError: boolean; }
  | { message: string; rejected: true; };

export interface ExternalAgentProjectThreadRecord {
  thread: Thread;
  promptFingerprint: string;
  syncedPrompt: string;
  definitionFingerprint: string;
  syncedDefinition: CompiledAgentDefinition;
}

export interface ExternalAgentProjectChangedPayload {
  projectId: string;
}

export type ExternalAgentProjectRunBlockReason =
  "pendingToolResult" | "sourceUnavailable" | "staleToolSnapshot";

/** A frozen tool step can remain earlier in an edited or reordered Thread. */
export function hasPendingExternalAgentProjectToolResult(
  record: ExternalAgentProjectThreadRecord
): boolean {
  return Boolean(
    record.thread.context?.messages?.some(
      message =>
        message.role === "assistant"
        && message.toolCalls?.some(toolCall => toolCall.output === undefined)
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
  if (project.status !== "ready") {
    return "sourceUnavailable";
  }
  if (hasPendingExternalAgentProjectToolResult(record)) {
    return "pendingToolResult";
  }
  const projectTools = (record.thread.context?.tools ?? []).filter(
    (tool): tool is ProjectTool => tool.type === "project"
  );
  if (projectTools.some(tool => tool.snapshot !== project.snapshot)) {
    return "staleToolSnapshot";
  }
  return null;
}
