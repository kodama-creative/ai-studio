export class RuntimeExecutionEnvUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuntimeExecutionEnvUnavailableError";
  }
}
