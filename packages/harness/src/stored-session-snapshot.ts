import type { HarnessSessionSnapshot } from "./protocol";

export function isStoredSessionSnapshot(
  value: unknown
): value is HarnessSessionSnapshot {
  if (!_isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.agentId === "string" &&
    typeof value.generationId === "string" &&
    (value.mode === "conversation" || value.mode === "task") &&
    (value.status === "waiting" ||
      value.status === "running" ||
      value.status === "completed" ||
      value.status === "failed") &&
    Array.isArray(value.messages) &&
    _isRecord(value.state) &&
    _isSequence(value.turnSequence) &&
    _isSequence(value.eventSequence) &&
    _isTimestamp(value.createdAt) &&
    _isTimestamp(value.updatedAt) &&
    (value.activeTurnId === undefined ||
      typeof value.activeTurnId === "string") &&
    (value.error === undefined || typeof value.error === "string")
  );
}

function _isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function _isSequence(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function _isTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
