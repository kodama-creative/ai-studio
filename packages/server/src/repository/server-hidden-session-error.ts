export class ServerHiddenSessionError extends Error {
  constructor() {
    super("Server Session is unavailable");
    this.name = "ServerHiddenSessionError";
  }
}
