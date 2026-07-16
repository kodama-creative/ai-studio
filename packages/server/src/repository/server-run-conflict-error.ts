export class ServerRunConflictError extends Error {
  constructor() {
    super("Server Session already has an active Run");
    this.name = "ServerRunConflictError";
  }
}
