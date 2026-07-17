import { immutableSnapshot } from "./immutable-snapshot";
import {
  type RuntimeRunJournalEntry,
  SessionStoreInvariantError,
  type StoredRuntimeSession
} from "./session-store";

export const RUNTIME_RUN_REPLAY_CURSOR_SCHEMA_VERSION = 1 as const;

/** Host-authorized Session/Run scope. Principal checks happen before this API. */
export interface RuntimeRunReplayAuthorization {
  readonly runId: string;
  readonly sessionId: string;
}

export interface RuntimeRunReplayCursor {
  readonly runId: string;
  readonly schemaVersion: typeof RUNTIME_RUN_REPLAY_CURSOR_SCHEMA_VERSION;
  readonly sequence: number;
  readonly sessionId: string;
}

export interface RuntimeRunReplayEvent {
  readonly cursor: RuntimeRunReplayCursor;
  readonly entry: RuntimeRunJournalEntry;
}

/**
 * Project one Run's durable control-plane journal after an exclusive cursor.
 * Cursors are accepted only when they identify a real entry in the authorized
 * Session/Run scope; transport/principal authorization remains Host-owned.
 */
export function replayRuntimeRunEvents(
  session: StoredRuntimeSession,
  authorization: RuntimeRunReplayAuthorization,
  after?: RuntimeRunReplayCursor
): readonly RuntimeRunReplayEvent[] {
  if (authorization.sessionId !== session.snapshot.id) {
    throw new SessionStoreInvariantError(
      `Replay authorization does not belong to Session ${session.snapshot.id}`
    );
  }
  if (!session.snapshot.runs.some(run => run.id === authorization.runId)) {
    throw new SessionStoreInvariantError(
      `Runtime Run ${authorization.runId} does not exist in Session ${authorization.sessionId}`
    );
  }
  const afterSequence = after
    ? _validatedCursorSequence(session, authorization, after)
    : 0;
  const events = session.journal
    .filter(entry =>
      entry.type !== "sessionStateReplaced"
      && entry.runId === authorization.runId
      && entry.sequence > afterSequence)
    .map(entry => ({
      entry,
      cursor: {
        schemaVersion: RUNTIME_RUN_REPLAY_CURSOR_SCHEMA_VERSION,
        sessionId: authorization.sessionId,
        runId: authorization.runId,
        sequence: entry.sequence
      }
    }));
  return immutableSnapshot(events);
}

function _validatedCursorSequence(
  session: StoredRuntimeSession,
  authorization: RuntimeRunReplayAuthorization,
  cursor: RuntimeRunReplayCursor
): number {
  if (cursor.schemaVersion !== RUNTIME_RUN_REPLAY_CURSOR_SCHEMA_VERSION) {
    throw new SessionStoreInvariantError(
      `Unsupported Runtime Run replay cursor schema: ${String(cursor.schemaVersion)}`
    );
  }
  if (
    cursor.sessionId !== authorization.sessionId
    || cursor.runId !== authorization.runId
  ) {
    throw new SessionStoreInvariantError(
      "Runtime Run replay cursor is outside the authorized Session/Run scope"
    );
  }
  if (!Number.isSafeInteger(cursor.sequence) || cursor.sequence < 1) {
    throw new SessionStoreInvariantError(
      "Runtime Run replay cursor sequence must be a positive safe integer"
    );
  }
  const entry = session.journal[cursor.sequence - 1];
  if (
    entry?.sequence !== cursor.sequence
    || entry.type === "sessionStateReplaced"
    || entry.runId !== cursor.runId
  ) {
    throw new SessionStoreInvariantError(
      "Runtime Run replay cursor does not identify a durable entry in scope"
    );
  }
  return cursor.sequence;
}
