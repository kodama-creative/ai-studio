import { STRUCTURED_OUTPUT_TOOL_NAME } from "@llm-space/runtime";

import type {
  ThreadStructuredOutput,
  ToolCall
} from "@llm-space/core";

export function structuredOutputFromToolCall(
  toolCall: ToolCall
): ThreadStructuredOutput | undefined {
  if (toolCall.input.name !== STRUCTURED_OUTPUT_TOOL_NAME) { return undefined; }
  const details = toolCall.output?.details;
  if (!details || typeof details !== "object" || Array.isArray(details)) {
    return undefined;
  }
  const value = (details as Record<string, unknown>).structuredOutput;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const result = value as Record<string, unknown>;
  return typeof result.contract === "string"
    && result.contract.trim().length > 0
    && typeof result.schemaFingerprint === "string"
    && /^[0-9a-f]{64}$/.test(result.schemaFingerprint)
    && _isJsonValue(result.value, new WeakSet())
    ? {
      contract: result.contract,
      schemaFingerprint: result.schemaFingerprint,
      value: structuredClone(result.value)
    }
    : undefined;
}

function _isJsonValue(value: unknown, ancestors: WeakSet<object>): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return true;
  }
  if (typeof value === "number") { return Number.isFinite(value); }
  if (typeof value !== "object" || ancestors.has(value)) { return false; }
  const prototype = Object.getPrototypeOf(value) as object | null;
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    return false;
  }
  ancestors.add(value);
  const valid = (Array.isArray(value)
    ? value
    : Object.values(value as Record<string, unknown>))
    .every(child => _isJsonValue(child, ancestors));
  ancestors.delete(value);
  return valid;
}
