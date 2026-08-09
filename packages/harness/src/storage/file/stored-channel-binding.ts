import type { ChannelBinding } from "../../channel/channel-binding-repository";

import { isRecord } from "./is-record";
import { isStoredHarnessPrincipal } from "./stored-harness-principal";

export function isStoredChannelBinding(
  value: unknown
): value is ChannelBinding {
  if (!isRecord(value)) return false;
  const record = value;
  return (
    typeof record.channelId === "string" &&
    typeof record.address === "string" &&
    typeof record.sessionId === "string" &&
    (record.initiator === null || isStoredHarnessPrincipal(record.initiator)) &&
    typeof record.createdAt === "number" &&
    Number.isFinite(record.createdAt) &&
    record.createdAt >= 0
  );
}
