export class SandboxUnavailableError extends Error {
  readonly code = "sandboxUnavailable" as const;

  constructor(message = "The selected Agent requires an available Sandbox") {
    super(message);
    this.name = "SandboxUnavailableError";
  }
}
