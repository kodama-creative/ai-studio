import type { SessionCommand } from "../../session/protocol";

import { isRecord } from "./is-record";
import { isStoredHarnessPrincipal } from "./stored-harness-principal";

export function isStoredSessionCommand(
  value: unknown,
  sessionId: string
): value is SessionCommand {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    value.sessionId === sessionId &&
    typeof value.turnId === "string" &&
    typeof value.message === "string" &&
    (value.principal === null || isStoredHarnessPrincipal(value.principal)) &&
    (value.source === undefined ||
      (isRecord(value.source) &&
        typeof value.source.channelId === "string" &&
        typeof value.source.address === "string" &&
        (value.source.deliveryId === undefined ||
          typeof value.source.deliveryId === "string"))) &&
    typeof value.createdAt === "number" &&
    Number.isFinite(value.createdAt) &&
    value.createdAt >= 0 &&
    typeof value.sequence === "number" &&
    Number.isInteger(value.sequence) &&
    value.sequence > 0
  );
}
