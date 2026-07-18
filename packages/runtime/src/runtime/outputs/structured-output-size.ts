export const DEFAULT_MAX_STRUCTURED_OUTPUT_BYTES = 256 * 1024;
export const MIN_MAX_STRUCTURED_OUTPUT_BYTES = 1024;
export const MAX_MAX_STRUCTURED_OUTPUT_BYTES = 768 * 1024;

export function assertMaxStructuredOutputBytes(value: number): number {
  if (
    !Number.isSafeInteger(value)
    || value < MIN_MAX_STRUCTURED_OUTPUT_BYTES
    || value > MAX_MAX_STRUCTURED_OUTPUT_BYTES
  ) {
    throw new TypeError(
      "maxStructuredOutputBytes must be an integer from 1024 through 786432"
    );
  }
  return value;
}
