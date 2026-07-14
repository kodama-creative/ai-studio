import type { AgentProjectDiagnostic } from "../../shared/agent-project";

import type { AgentProjectSnapshot } from "./agent-project";

class AgentProjectValidationError extends Error {
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
