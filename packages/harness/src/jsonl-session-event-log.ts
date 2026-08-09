import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { encodeSessionStorageKey } from "./encode-session-storage-key";
import { getFileErrorCode } from "./get-file-error-code";
import { getFileEventLogCoordinator } from "./get-file-event-log-coordinator";
import type { HarnessEvent, SessionEventCursor } from "./protocol";
import type { SessionEventLog } from "./session-event-log";
import { isStoredSessionEvent } from "./stored-session-event";

export class JsonlSessionEventLog implements SessionEventLog {
  private readonly _coordinator = getFileEventLogCoordinator();

  constructor(private readonly _root: string) {}

  async append(event: HarnessEvent): Promise<void> {
    const path = this._eventPath(event.sessionId);
    await this._coordinator.append(path, async () => {
      await mkdir(this._eventsRoot(), { recursive: true, mode: 0o700 });
      await appendFile(path, `${JSON.stringify(event)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
    });
  }

  async *read(
    sessionId: string,
    cursor: SessionEventCursor = {}
  ): AsyncIterable<HarnessEvent> {
    const path = this._eventPath(sessionId);
    let afterSequence = cursor.afterSequence ?? 0;
    while (!cursor.signal?.aborted) {
      const events = await _readEvents(path, sessionId);
      for (const event of events) {
        if (event.sequence <= afterSequence) continue;
        afterSequence = event.sequence;
        yield structuredClone(event);
      }
      if (cursor.follow !== true) return;
      await this._waitForAppend(path, sessionId, afterSequence, cursor.signal);
    }
  }

  private _eventsRoot(): string {
    return join(this._root, "events");
  }

  private _eventPath(sessionId: string): string {
    return resolve(
      this._eventsRoot(),
      `${encodeSessionStorageKey(sessionId)}.jsonl`
    );
  }

  private async _waitForAppend(
    path: string,
    sessionId: string,
    afterSequence: number,
    signal: AbortSignal | undefined
  ): Promise<void> {
    await this._coordinator.wait(
      path,
      signal,
      async () => (await this._latestSequence(path, sessionId)) > afterSequence
    );
  }

  private async _latestSequence(
    path: string,
    sessionId: string
  ): Promise<number> {
    return (await _readEvents(path, sessionId)).at(-1)?.sequence ?? 0;
  }
}

async function _readEvents(
  path: string,
  sessionId: string
): Promise<HarnessEvent[]> {
  let source: string;
  try {
    source = await readFile(path, "utf8");
  } catch (error) {
    if (getFileErrorCode(error) === "ENOENT") return [];
    throw error;
  }
  const result: HarnessEvent[] = [];
  for (const [index, line] of source.split("\n").entries()) {
    if (line.length === 0) continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch (cause) {
      throw new Error(
        `Invalid session event JSON at line ${index + 1} in "${path}".`,
        { cause }
      );
    }
    if (!isStoredSessionEvent(value, sessionId)) {
      throw new Error(
        `Invalid session event at line ${index + 1} in "${path}".`
      );
    }
    result.push(value);
  }
  return result;
}
