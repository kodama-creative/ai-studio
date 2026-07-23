export class DurableOperationFingerprintMismatchError extends Error {
  readonly code = "operationFingerprintMismatch" as const;
  readonly operationId: string;

  constructor(operationId: string) {
    super(`Durable operation ${operationId} request fingerprint changed`);
    this.name = "DurableOperationFingerprintMismatchError";
    this.operationId = operationId;
  }
}
