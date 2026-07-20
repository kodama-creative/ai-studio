export type AgentProjectDiagnosticSeverity = "error" | "warning";

export type AgentProjectDiagnosticCode =
  | "connection_export_invalid"
  | "connection_import_failed"
  | "connection_name_duplicate"
  | "connection_name_invalid"
  | "definition_export_invalid"
  | "definition_import_failed"
  | "definition_missing"
  | "instruction_entry_import_failed"
  | "instruction_entry_invalid"
  | "instructions_missing"
  | "instructions_read_failed"
  | "output_export_invalid"
  | "output_import_failed"
  | "output_name_duplicate"
  | "sandbox_export_invalid"
  | "sandbox_import_failed"
  | "sandbox_workspace_invalid"
  | "skill_invalid"
  | "state_export_invalid"
  | "state_import_failed"
  | "state_name_duplicate"
  | "tool_export_invalid"
  | "tool_import_failed"
  | "tool_name_duplicate";

export interface AgentProjectDiagnostic {
  readonly severity: AgentProjectDiagnosticSeverity;
  readonly code: AgentProjectDiagnosticCode;
  readonly message: string;
  readonly path: string;
}
