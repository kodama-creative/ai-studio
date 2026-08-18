import path from "node:path";

import {
  atomicWriteJsonFile,
  readJsonFile,
} from "@llm-space/core/server";
import { inject, injectable, preDestroy } from "inversify";
import { z } from "zod";

import type { Disposable } from "../../shared/disposable";
import { DEFAULT_UPDATE_MODE, type UpdateMode } from "../../shared/updates";
import { APP_HOME_PATH } from "../app/desktop-paths";

/**
 * Persisted updater state (`settings/updates.json`): the user's update-mode
 * preference and the last bundle hash we launched, used to detect "we just
 * updated" after an applyUpdate relaunch.
 */
interface UpdatesDocument {
  mode?: UpdateMode;
  /**
   * Last launched bundle hash, keyed by app identifier. `settings/` is shared
   * by every edition (`getLlmSpaceHomePath()` is app-name independent), but the
   * hash covers the whole bundle — so the regular and Performance editions
   * always differ, even at the same version. A single flat hash here would read
   * as "we just updated" on every switch between them and pop a false toast.
   * `mode` stays flat: it is a user preference, not bundle identity.
   */
  lastSeenHashes?: Record<string, string>;
}

const VALID_MODES: readonly UpdateMode[] = ["automatic", "manual", "off"];
const UpdatesStateSchema: z.ZodType<UpdatesDocument> = z.object({
  mode: z.enum(VALID_MODES).optional(),
  lastSeenHashes: z.record(z.string(), z.string()).optional(),
});

/** Process-owned, serialized persistence for updater preferences and identity. */
@injectable()
export class UpdatesState implements Disposable {
  private _queue: Promise<unknown> = Promise.resolve();
  private _disposed = false;

  private readonly _filePath: string;

  constructor(@inject(APP_HOME_PATH) homePath: string) {
    this._filePath = path.join(homePath, "settings", "updates.json");
  }

  async getMode(): Promise<UpdateMode> {
    const mode = (await this._read()).mode;
    return mode && VALID_MODES.includes(mode) ? mode : DEFAULT_UPDATE_MODE;
  }

  async setMode(mode: UpdateMode): Promise<void> {
    await this._update((state) => ({
      state: { ...state, mode },
      result: undefined,
    }));
  }

  async getLastSeenHash(identifier: string): Promise<string | undefined> {
    return (await this._read()).lastSeenHashes?.[identifier];
  }

  async setLastSeenHash(identifier: string, hash: string): Promise<void> {
    await this._update((state) => ({
      state: {
        ...state,
        lastSeenHashes: {
          ...state.lastSeenHashes,
          [identifier]: hash,
        },
      },
      result: undefined,
    }));
  }

  @preDestroy()
  async dispose(): Promise<void> {
    this._disposed = true;
    await this._queue.catch(() => undefined);
  }

  private _read(): Promise<UpdatesDocument> {
    return this._enqueue(() => this._load());
  }

  private _update<T>(
    mutate: (state: UpdatesDocument) => { state: UpdatesDocument; result: T }
  ): Promise<T> {
    return this._enqueue(async () => {
      const update = mutate(await this._load());
      await atomicWriteJsonFile(this._filePath, update.state);
      return update.result;
    });
  }

  private _enqueue<T>(operation: () => T | Promise<T>): Promise<T> {
    if (this._disposed) {
      return Promise.reject(new Error("Updates state is disposed."));
    }
    const queued = this._queue.catch(() => undefined).then(operation);
    this._queue = queued;
    return queued;
  }

  private async _load(): Promise<UpdatesDocument> {
    return (
      await readJsonFile(this._filePath, {
        schema: UpdatesStateSchema,
        recovery: "best-effort",
        fallback: () => ({}),
        seedMissing: false,
      })
    ).value;
  }
}
