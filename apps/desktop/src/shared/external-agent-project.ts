import { getThreadRuntimeProfile } from "@llm-space/core";

import type { Message, ProjectTool, Thread } from "@llm-space/core";
import type { CompiledAgentDefinition } from "@llm-space/runtime";
import type { StoredRuntimeSession } from "@llm-space/runtime/harness";

import type { SkillInfo } from "./skills";

export type ExternalAgentProjectStatus =
  | "building"
  | "invalid"
  | "missing"
  | "ready";

export interface ExternalAgentProjectDiagnostic {
  code: string;
  message: string;
  severity: "error" | "warning";
  sourcePath: string | null;
}

export type ExternalAgentProjectCapabilityKind =
  | "connection"
  | "dynamicTools"
  | "instructions"
  | "output"
  | "skill"
  | "state"
  | "subagent"
  | "tool";

export interface ExternalAgentProjectCapabilitySummary {
  detail?: string;
  kind: ExternalAgentProjectCapabilityKind;
  name: string;
  sourcePath: string;
}

export interface ExternalAgentProjectArtifactSummary {
  capabilities: ExternalAgentProjectCapabilitySummary[];
  environment: Array<{
    kind: "config" | "secret";
    name: string;
    required: boolean;
  }>;
  fingerprint: string;
  limits: CompiledAgentDefinition["limits"] | null;
  model: {
    dynamic: boolean;
    id: string;
    reasoning: string | null;
  };
  sandbox: {
    sourcePath: string;
    workspaceFileCount: number;
  } | null;
}

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
  artifactSummary: ExternalAgentProjectArtifactSummary | null;
  instructions: string;
  definition: CompiledAgentDefinition | null;
  definitionFingerprint: string;
  promptFingerprint: string;
  snapshot: string;
  sandboxRequired: boolean;
  tools: ProjectTool[];
  outputs: Array<{
    description: string;
    name: string;
    schema: unknown;
    schemaFingerprint: string;
  }>;
  skills: SkillInfo[];
  diagnostics: ExternalAgentProjectDiagnostic[];
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

export interface ExternalAgentProjectSubagentRun {
  readonly artifactFingerprint: string;
  readonly capabilities: ReadonlyArray<{
    readonly kind: "skill" | "tool";
    readonly name: string;
    readonly sourcePath: string;
  }>;
  readonly child: {
    readonly runId: string;
    readonly sessionId: string;
  };
  readonly createdAt: string;
  readonly description: string;
  readonly instructions: string;
  readonly message: string;
  readonly messages: readonly Message[];
  readonly model: CompiledAgentDefinition["model"];
  readonly limits: CompiledAgentDefinition["limits"] | null;
  readonly parent: {
    readonly runId: string;
    readonly sessionId: string;
    readonly toolCallId: string;
  };
  readonly retryOf?: {
    readonly runId: string;
    readonly sessionId: string;
  };
  readonly runtimeSession: StoredRuntimeSession;
  readonly sandbox: {
    readonly mode: "direct" | "isolated" | "shared";
    readonly revalidationFingerprint?: string;
  };
  readonly schemaVersion: 1;
  readonly status:
    | "cancelled"
    | "completed"
    | "failed"
    | "outcomeUnknown"
    | "preparing"
    | "running"
    | "waitingForApproval"
    | "waitingForBudget"
    | "waitingForContinue"
    | "waitingForToolResults";
  readonly subagentId: string;
  readonly terminal?: {
    readonly error?: { readonly code: string; readonly message: string; };
    readonly result?: string;
    readonly status: "cancelled" | "completed" | "failed" | "outcomeUnknown";
  };
  readonly updatedAt: string;
}

export interface ExternalAgentProjectThreadRecord {
  readonly definitionFingerprint: string;
  readonly promptFingerprint: string;
  readonly subagentRuns?: readonly ExternalAgentProjectSubagentRun[];
  readonly syncedDefinition: CompiledAgentDefinition;
  readonly syncedPrompt: string;
  readonly thread: Thread;
}

export interface ExternalAgentProjectChangedPayload {
  projectId: string;
}

export type ExternalAgentProjectRunBlockReason =
  | "pendingToolResult"
  | "sandboxRequired"
  | "sourceUnavailable"
  | "staleToolSnapshot";

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
  if (
    project.sandboxRequired
    && getThreadRuntimeProfile(record.thread).type === "desktopDirect"
  ) {
    return "sandboxRequired";
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
