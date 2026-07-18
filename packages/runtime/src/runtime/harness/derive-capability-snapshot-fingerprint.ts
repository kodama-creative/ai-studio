import { sha256 } from "./sha256";

import type { RuntimeTurnCapabilitySnapshot } from "./session-store";

export type RuntimeTurnCapabilitySnapshotContent = Omit<
  RuntimeTurnCapabilitySnapshot,
  "fingerprint"
>;

export async function deriveCapabilitySnapshotFingerprint(
  content: RuntimeTurnCapabilitySnapshotContent
): Promise<string> {
  return sha256(JSON.stringify(content));
}
