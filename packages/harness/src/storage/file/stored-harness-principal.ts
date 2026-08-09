import type { HarnessPrincipal } from "../../session/protocol";

import { isRecord } from "./is-record";

export function isStoredHarnessPrincipal(
  value: unknown
): value is HarnessPrincipal {
  if (!isRecord(value) || !isRecord(value.attributes)) return false;
  return (
    Object.values(value.attributes).every(
      (attribute) =>
        typeof attribute === "string" ||
        (Array.isArray(attribute) &&
          attribute.every((item) => typeof item === "string"))
    ) &&
    typeof value.authenticator === "string" &&
    typeof value.principalId === "string" &&
    typeof value.principalType === "string" &&
    (value.issuer === undefined || typeof value.issuer === "string") &&
    (value.subject === undefined || typeof value.subject === "string")
  );
}
