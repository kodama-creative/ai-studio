export type AgentProjectDiagnosticSeverity = "error" | "warning";

export type AgentProjectDiagnosticCode =
  | "definition_missing"
  | "definition_import_failed"
  | "definition_export_invalid"
  | "instructions_missing"
  | "instructions_read_failed"
  | "tool_import_failed"
  | "tool_export_invalid"
  | "tool_name_duplicate"
  | "skill_invalid";

export interface AgentProjectDiagnostic {
  readonly severity: AgentProjectDiagnosticSeverity;
  readonly code: AgentProjectDiagnosticCode;
  readonly message: string;
  readonly path: string;
}
