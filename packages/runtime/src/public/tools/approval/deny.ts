import type { ApprovalDeniedRequirement } from "../../definitions/approval";

export function deny(reason: string): ApprovalDeniedRequirement {
  const normalized = reason.trim();
  if (normalized.length === 0 || normalized.length > 1_024) {
    throw new TypeError("Approval denial reason must contain 1-1024 characters");
  }
  return { type: "deny", reason: normalized };
}
