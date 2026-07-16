export class ServerEventTooLargeError extends Error {
  constructor() {
    super("Server event exceeds the wire-size limit");
    this.name = "ServerEventTooLargeError";
  }
}
