import type { HarnessSessionSnapshot } from "../../session/protocol";

import { isRecord } from "./is-record";
import { isStoredHarnessPrincipal } from "./stored-harness-principal";

export function isStoredSessionSnapshot(
  value: unknown
): value is HarnessSessionSnapshot {
  if (!isRecord(value)) return false;
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
    isRecord(value.state) &&
    (value.auth === undefined ||
      (isRecord(value.auth) &&
        (value.auth.initiator === null ||
          isStoredHarnessPrincipal(value.auth.initiator)))) &&
    _isSequence(value.turnSequence) &&
    _isSequence(value.eventSequence) &&
    _isTimestamp(value.createdAt) &&
    _isTimestamp(value.updatedAt) &&
    (value.activeTurnId === undefined ||
      typeof value.activeTurnId === "string") &&
    (value.activeCommandId === undefined ||
      typeof value.activeCommandId === "string") &&
    (value.lastCommand === undefined ||
      (isRecord(value.lastCommand) &&
        typeof value.lastCommand.commandId === "string" &&
        typeof value.lastCommand.turnId === "string" &&
        (value.lastCommand.status === "completed" ||
          value.lastCommand.status === "cancelled" ||
          value.lastCommand.status === "failed"))) &&
    (value.error === undefined || typeof value.error === "string")
  );
}

function _isSequence(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function _isTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
