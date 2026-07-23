export class DurableOperationOutcomeUnknownError extends Error {
  readonly code = "durableOperationOutcomeUnknown" as const;
  readonly operationId: string;

  constructor(operationId: string, message?: string) {
    super(message ?? `Durable operation ${operationId} has an unknown outcome`);
    this.name = "DurableOperationOutcomeUnknownError";
    this.operationId = operationId;
  }
}
