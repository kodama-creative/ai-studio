export class ProjectToolCallRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectToolCallRejectedError";
  }
}
