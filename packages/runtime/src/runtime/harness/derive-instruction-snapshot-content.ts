import { sha256 } from "./sha256";

import type { RuntimeTurnInstructionSnapshot } from "./session-store";

export async function deriveInstructionSnapshotContent(
  entries: RuntimeTurnInstructionSnapshot["entries"]
): Promise<{ fingerprint: string; markdown: string; }> {
  return {
    fingerprint: await sha256(JSON.stringify(entries)),
    markdown: entries.map(entry => entry.markdown).filter(Boolean).join("\n\n")
  };
}
