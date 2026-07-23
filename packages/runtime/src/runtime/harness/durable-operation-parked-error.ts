export class DurableOperationParkedError extends Error {
  readonly code = "durableOperationParked" as const;
  readonly operationId: string;
  readonly parkId: string;

  constructor(operationId: string, parkId: string) {
    super(`Durable operation ${operationId} is parked at ${parkId}`);
    this.name = "DurableOperationParkedError";
    this.operationId = operationId;
    this.parkId = parkId;
  }
}
