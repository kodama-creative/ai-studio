import type { HarnessEvent } from "../../session/protocol";

import { isRecord } from "./is-record";

export function isStoredSessionEvent(
  value: unknown,
  sessionId: string
): value is HarnessEvent {
  if (!isRecord(value) || !isRecord(value.event)) return false;
  return (
    value.sessionId === sessionId &&
    Number.isInteger(value.sequence) &&
    typeof value.sequence === "number" &&
    value.sequence > 0 &&
    _isTimestamp(value.timestamp) &&
    typeof value.event.type === "string"
  );
}

function _isTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
