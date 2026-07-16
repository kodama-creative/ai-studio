export class ServerCapacityError extends Error {
  constructor() {
    super("Agent Server active Run capacity is exhausted");
    this.name = "ServerCapacityError";
  }
}
