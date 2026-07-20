export class RuntimeSandboxUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuntimeSandboxUnavailableError";
  }
}

export class RuntimeSandboxWorkspaceLostError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuntimeSandboxWorkspaceLostError";
  }
}
