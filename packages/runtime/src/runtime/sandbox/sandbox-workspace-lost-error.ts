export class SandboxWorkspaceLostError extends Error {
  readonly code = "sandboxWorkspaceLost" as const;

  constructor() {
    super("The Sandbox workspace is missing; create a new Thread");
    this.name = "SandboxWorkspaceLostError";
  }
}
