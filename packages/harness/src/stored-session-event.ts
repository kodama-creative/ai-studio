import type { HarnessEvent } from "./protocol";

export function isStoredSessionEvent(
  value: unknown,
  sessionId: string
): value is HarnessEvent {
  if (!_isRecord(value) || !_isRecord(value.event)) return false;
  return (
    value.sessionId === sessionId &&
    Number.isInteger(value.sequence) &&
    typeof value.sequence === "number" &&
    value.sequence > 0 &&
    _isTimestamp(value.timestamp) &&
    typeof value.event.type === "string"
  );
}

function _isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function _isTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
