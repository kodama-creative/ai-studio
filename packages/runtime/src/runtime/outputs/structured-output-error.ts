import type { StructuredOutputFailureCode } from "../../shared/structured-output";

export class StructuredOutputError extends Error {
  readonly code: StructuredOutputFailureCode;

  constructor(code: StructuredOutputFailureCode, message: string) {
    super(message);
    this.name = "StructuredOutputError";
    this.code = code;
  }
}
