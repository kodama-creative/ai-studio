export class RuntimeRunLimitExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuntimeRunLimitExceededError";
  }
}
