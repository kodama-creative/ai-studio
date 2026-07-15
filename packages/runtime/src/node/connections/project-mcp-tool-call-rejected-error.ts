export class ProjectMcpToolCallRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectMcpToolCallRejectedError";
  }
}
