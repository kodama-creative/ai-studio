export class RuntimeStructuredOutputError extends Error {
  readonly code:
    | "structured_output_invalid"
    | "structured_output_missing"
    | "structured_output_too_large";

  constructor(message: string, code: RuntimeStructuredOutputError["code"]) {
    super(message);
    this.name = "RuntimeStructuredOutputError";
    this.code = code;
  }
}
