import type {
  AgentHarnessResources,
  AgentTool,
  Skill,
} from "@earendil-works/pi-agent-core";

import type { ResolvedAgentDefinition } from "./agent-definition";

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

export interface AgentProjectSnapshot {
  readonly root: string;
  readonly definition?: ResolvedAgentDefinition;
  readonly instructions: string;
  readonly tools: readonly AgentTool[];
  readonly resources: Readonly<AgentHarnessResources<Skill>>;
  readonly diagnostics: readonly AgentProjectDiagnostic[];
  /** Changes whenever the discovered source bytes or tool module mtimes change. */
  readonly fingerprint: string;
}

export class AgentProjectValidationError extends Error {
  readonly diagnostics: readonly AgentProjectDiagnostic[];

  constructor(diagnostics: readonly AgentProjectDiagnostic[]) {
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
