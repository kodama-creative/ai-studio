import type {
  AgentHarnessResources,
  AgentTool,
  Skill,
} from "@earendil-works/pi-agent-core";

export type AgentProjectDiagnosticSeverity = "error" | "warning";

export type AgentProjectDiagnosticCode =
  | "instructions_missing"
  | "instructions_read_failed"
  | "tool_import_failed"
  | "tool_export_invalid"
  | "tool_name_duplicate"
  | "skill_invalid";

export interface AgentProjectDiagnostic {
  severity: AgentProjectDiagnosticSeverity;
  code: AgentProjectDiagnosticCode;
  message: string;
  path: string;
}

export interface AgentProjectSnapshot {
  root: string;
  instructions: string;
  tools: AgentTool[];
  resources: AgentHarnessResources<Skill>;
  diagnostics: AgentProjectDiagnostic[];
  /** Changes whenever the discovered source bytes or tool module mtimes change. */
  fingerprint: string;
}

export class AgentProjectValidationError extends Error {
  readonly diagnostics: AgentProjectDiagnostic[];

  constructor(diagnostics: AgentProjectDiagnostic[]) {
    super(
      diagnostics
        .filter((diagnostic) => diagnostic.severity === "error")
        .map((diagnostic) => diagnostic.message)
        .join("\n") || "Agent project validation failed"
    );
    this.name = "AgentProjectValidationError";
    this.diagnostics = diagnostics;
  }
}

export function assertValidAgentProject(
  snapshot: AgentProjectSnapshot
): AgentProjectSnapshot {
  if (
    snapshot.diagnostics.some((diagnostic) => diagnostic.severity === "error")
  ) {
    throw new AgentProjectValidationError(snapshot.diagnostics);
  }
  return snapshot;
}
