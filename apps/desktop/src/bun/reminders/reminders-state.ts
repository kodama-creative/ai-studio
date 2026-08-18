import { randomUUID } from "node:crypto";
import { join } from "node:path";

import {
  atomicWriteJsonFile,
  readJsonFile,
} from "@llm-space/core/server";
import { inject, injectable, preDestroy, unmanaged } from "inversify";
import { z } from "zod";

import type { Disposable } from "../../shared/disposable";
import type { FeatureReminder } from "../../shared/feature-reminders";
import { FEATURE_REMINDERS } from "../../shared/feature-reminders";
import type { RemindersRequests } from "../../shared/reminders-rpc";
import { APP_HOME_PATH } from "../app/desktop-paths";

/**
 * Persisted reminder state (`settings/reminders.json`). Today it backs the
 * GitHub-star nudge; the file is namespaced per reminder so future pushes
 * (changelog, etc.) can slot in beside `githubStar` without reshaping it.
 */
interface GithubStarReminder {
  // How many times the app has been opened (bumped once per launch). The very
  // first appearance is gated on this reaching 2 — i.e. the second open.
  openCount?: number;
  // When we last decided to show the reminder (ms epoch); anchors the 2-day
  // throttle for every appearance after the first.
  lastShownDate?: number;
  // How many times the reminder has been shown; capped at MAX_SHOWN_COUNT.
  shownCount?: number;
  // Id and decision for the latest real app launch. Renderer effects may ask
  // more than once (for example under React Strict Mode); repeated requests
  // for the same launch must return the same answer without bumping counters.
  lastResolvedLaunchId?: string;
  lastResolvedShow?: boolean;
  // Retired for good — set when the user clicks through to GitHub, or once the
  // nag cap is reached. Never shown again after this.
  dismissedForever?: boolean;
}

interface RemindersDocument {
  githubStar?: GithubStarReminder;
  // Ids of one-time feature reminders the user has already been shown. Each
  // reminder pops at most once ever; see `resolveNextFeatureReminder`.
  featureRemindersSeen?: string[];
}

const RemindersStateSchema: z.ZodType<RemindersDocument> = z.object({
  githubStar: z
    .object({
      openCount: z.number().optional(),
      lastShownDate: z.number().optional(),
      shownCount: z.number().optional(),
      lastResolvedLaunchId: z.string().optional(),
      lastResolvedShow: z.boolean().optional(),
      dismissedForever: z.boolean().optional(),
    })
    .optional(),
  featureRemindersSeen: z.array(z.string()).optional(),
});

/** Show the star nudge at most once every 2 days. */
const REMINDER_INTERVAL_MS = 2 * 24 * 60 * 60 * 1000;
/** Give up (retire the reminder) after this many shows, click or no click. */
const MAX_SHOWN_COUNT = 3;
export interface RemindersStateOptions {
  readonly launchId?: string;
  readonly now?: () => number;
}

/** Whether the reminder should appear on this open (pure; no side effects). */
function _shouldShow(
  star: GithubStarReminder,
  openCount: number,
  now: number
): boolean {
  if (star.dismissedForever) return false;
  // First appearance is gated on the *second* open of the whole lifetime, not
  // on elapsed time — the first launch just counts and stays silent.
  if (star.lastShownDate == null) return openCount >= 2;
  // Every appearance after the first is throttled to once every 2 days.
  return now - star.lastShownDate >= REMINDER_INTERVAL_MS;
}

/**
 * Decide whether to show the GitHub-star reminder on this app open, and record
 * the decision atomically so the caller only has to render.
 *
 * Rules (checked once per launch):
 * - Every launch bumps `openCount`; the first launch stays silent.
 * - The reminder first appears on the second open, regardless of elapsed time.
 * - Later appearances are throttled to once every 2 days since the last show.
 * - Retire permanently once the user clicks through, or after 3 shows.
 */
@injectable()
export class RemindersState implements RemindersRequests, Disposable {
  private readonly _launchId: string;
  private readonly _now: () => number;
  private _stateQueue: Promise<unknown> = Promise.resolve();
  private _disposed = false;
  private readonly _filePath: string;

  constructor(
    @inject(APP_HOME_PATH) homePath: string,
    @unmanaged()
    options: RemindersStateOptions = {}
  ) {
    this._filePath = join(homePath, "settings", "reminders.json");
    this._launchId = options.launchId ?? randomUUID();
    this._now = options.now ?? Date.now;
  }

  async shouldShowGithubStar(): Promise<{ show: boolean }> {
    return this._update((state) => {
      const star = state.githubStar ?? {};
      if (star.lastResolvedLaunchId === this._launchId) {
        return {
          state,
          result: { show: star.lastResolvedShow ?? false },
        };
      }

      const now = this._now();
      const openCount = (star.openCount ?? 0) + 1;
      const show = _shouldShow(star, openCount, now);
      const patch = show
        ? {
            openCount,
            lastShownDate: now,
            shownCount: (star.shownCount ?? 0) + 1,
            lastResolvedLaunchId: this._launchId,
            lastResolvedShow: show,
            dismissedForever: (star.shownCount ?? 0) + 1 >= MAX_SHOWN_COUNT,
          }
        : {
            openCount,
            lastResolvedLaunchId: this._launchId,
            lastResolvedShow: show,
          };
      return {
        state: { ...state, githubStar: { ...star, ...patch } },
        result: { show },
      };
    });
  }

  /** Retire the star reminder for good (the user clicked through to GitHub). */
  async dismissGithubStarForever(): Promise<void> {
    await this._update((state) => ({
      state: {
        ...state,
        githubStar: { ...state.githubStar, dismissedForever: true },
      },
      result: undefined,
    }));
  }

  /** Return the next unseen definition without consuming it. */
  async nextFeature(): Promise<FeatureReminder | null> {
    const seen = new Set((await this._read()).featureRemindersSeen ?? []);
    return FEATURE_REMINDERS.find((reminder) => !seen.has(reminder.id)) ?? null;
  }

  /** Record a feature reminder as seen so it never appears again. */
  async markFeatureSeen(id: string): Promise<void> {
    await this._update((state) => {
      const seen = new Set(state.featureRemindersSeen ?? []);
      seen.add(id);
      return {
        state: { ...state, featureRemindersSeen: [...seen] },
        result: undefined,
      };
    });
  }

  @preDestroy()
  async dispose(): Promise<void> {
    this._disposed = true;
    await this._stateQueue.catch(() => undefined);
  }

  private _read(): Promise<RemindersDocument> {
    return this._enqueue(() => this._load());
  }

  private _update<T>(
    mutate: (state: RemindersDocument) => {
      state: RemindersDocument;
      result: T;
    }
  ): Promise<T> {
    return this._enqueue(async () => {
      const update = mutate(await this._load());
      await atomicWriteJsonFile(this._filePath, update.state);
      return update.result;
    });
  }

  private _enqueue<T>(operation: () => T | Promise<T>): Promise<T> {
    if (this._disposed) {
      return Promise.reject(new Error("Reminders state is disposed."));
    }
    const queued = this._stateQueue.catch(() => undefined).then(operation);
    this._stateQueue = queued;
    return queued;
  }

  private async _load(): Promise<RemindersDocument> {
    return (
      await readJsonFile(this._filePath, {
        schema: RemindersStateSchema,
        recovery: "best-effort",
        fallback: () => ({}),
        seedMissing: false,
      })
    ).value;
  }
}
