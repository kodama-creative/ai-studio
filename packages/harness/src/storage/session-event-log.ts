import type { HarnessEvent, SessionEventCursor } from "../session/protocol";

export interface SessionEventLog {
  append(event: HarnessEvent): Promise<void>;
  read(
    sessionId: string,
    cursor?: SessionEventCursor
  ): AsyncIterable<HarnessEvent>;
}
