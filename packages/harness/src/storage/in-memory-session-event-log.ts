import type { HarnessEvent, SessionEventCursor } from "../session/protocol";

import type { SessionEventLog } from "./session-event-log";

export class InMemorySessionEventLog implements SessionEventLog {
  private readonly _events = new Map<string, HarnessEvent[]>();
  private readonly _waiters = new Map<string, Set<() => void>>();

  append(event: HarnessEvent): Promise<void> {
    const events = this._events.get(event.sessionId) ?? [];
    events.push(structuredClone(event));
    this._events.set(event.sessionId, events);
    const waiters = this._waiters.get(event.sessionId);
    if (waiters !== undefined) {
      this._waiters.delete(event.sessionId);
      for (const wake of waiters) wake();
    }
    return Promise.resolve();
  }

  async *read(
    sessionId: string,
    cursor: SessionEventCursor = {}
  ): AsyncIterable<HarnessEvent> {
    let afterSequence = cursor.afterSequence ?? 0;
    while (!cursor.signal?.aborted) {
      const events = this._events.get(sessionId) ?? [];
      for (const event of events) {
        if (event.sequence <= afterSequence) continue;
        afterSequence = event.sequence;
        yield structuredClone(event);
      }
      if (cursor.follow !== true) return;
      await this._waitForAppend(sessionId, afterSequence, cursor.signal);
    }
  }

  private _waitForAppend(
    sessionId: string,
    afterSequence: number,
    signal: AbortSignal | undefined
  ): Promise<void> {
    if (this._latestSequence(sessionId) > afterSequence) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      let waiters = this._waiters.get(sessionId);
      if (waiters === undefined) {
        waiters = new Set();
        this._waiters.set(sessionId, waiters);
      }
      const wake = () => {
        signal?.removeEventListener("abort", wake);
        waiters?.delete(wake);
        resolve();
      };
      waiters.add(wake);
      signal?.addEventListener("abort", wake, { once: true });
      if (this._latestSequence(sessionId) > afterSequence) wake();
    });
  }

  private _latestSequence(sessionId: string): number {
    return this._events.get(sessionId)?.at(-1)?.sequence ?? 0;
  }
}
