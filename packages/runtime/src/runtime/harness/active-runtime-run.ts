import {
  SessionStoreInvariantError,
  type StoredRuntimeSession
} from "./session-store";

import type { RuntimeRunSnapshot } from "./runtime-run";

/** Return the one active Runtime Run guaranteed by Session Store invariants. */
export function activeRuntimeRun(
  session: StoredRuntimeSession
): RuntimeRunSnapshot {
  const activeRunId = session.snapshot.activeRunId;
  const run = session.snapshot.runs.find(item => item.id === activeRunId);
  if (!run) {
    throw new SessionStoreInvariantError(
      `Session ${session.snapshot.id} has no active Runtime Run ${String(activeRunId)}`
    );
  }
  return run;
}
