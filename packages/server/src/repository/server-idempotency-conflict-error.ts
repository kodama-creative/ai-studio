export class ServerIdempotencyConflictError extends Error {
  constructor() {
    super("Idempotency key was already used with different input");
    this.name = "ServerIdempotencyConflictError";
  }
}
