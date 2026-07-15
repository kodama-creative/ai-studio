export type AgentProjectDiagnosticSeverity = "error" | "warning";

export type AgentProjectDiagnosticCode =
  | "connection_export_invalid"
  | "connection_import_failed"
  | "connection_name_duplicate"
  | "connection_name_invalid"
  | "definition_export_invalid"
  | "definition_import_failed"
  | "definition_missing"
  | "instructions_missing"
  | "instructions_read_failed"
  | "skill_invalid"
  | "tool_export_invalid"
  | "tool_import_failed"
  | "tool_name_duplicate";

export interface AgentProjectDiagnostic {
  readonly severity: AgentProjectDiagnosticSeverity;
  readonly code: AgentProjectDiagnosticCode;
  readonly message: string;
  readonly path: string;
}
