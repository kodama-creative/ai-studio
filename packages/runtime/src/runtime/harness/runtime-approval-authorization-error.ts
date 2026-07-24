export class RuntimeApprovalAuthorizationError extends Error {
  readonly code = "approvalUnauthorized" as const;

  constructor() {
    super("The authenticated principal cannot decide this tool approval");
    this.name = "RuntimeApprovalAuthorizationError";
  }
}
