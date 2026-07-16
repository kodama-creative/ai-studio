export class ServerCursorError extends Error {
  constructor() {
    super("Last-Event-ID does not identify a persisted event in this Run");
    this.name = "ServerCursorError";
  }
}
