export class RuntimeToolApprovalStaleError extends Error {
  readonly code = "approvalStale" as const;

  constructor() {
    super(
      "The tool approval expired because its Agent, Host policy, or principal identity changed"
    );
    this.name = "RuntimeToolApprovalStaleError";
  }
}
