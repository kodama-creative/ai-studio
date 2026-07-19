export class ExecutionEnvUnavailableError extends Error {
  readonly code = "executionEnvUnavailable" as const;

  constructor() {
    super("The selected tools require a Host-provided ExecutionEnv");
    this.name = "ExecutionEnvUnavailableError";
  }
}
