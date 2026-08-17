import { inject, injectable } from "inversify";

import type { FeatureReminder } from "@/shared/feature-reminders";
import {
  REMINDERS_SERVICE,
  type RemindersRequests,
} from "@/shared/reminders-rpc";

type Listener = () => void;

export interface RemindersSnapshot {
  readonly feature: FeatureReminder | null;
  readonly showGithubStar: boolean;
}

/**
 * Owns passive reminder reads and mutations. Reminder RPC is deliberately
 * best-effort: a transport failure must never become an unhandled renderer
 * rejection or interfere with the primary Playground/Studio workflows.
 */
@injectable()
export class RemindersController {
  private readonly _listeners = new Set<Listener>();
  private _active = false;
  private _lifecycle = 0;
  private _dismissGithubStarRequest: Promise<void> | null = null;
  private _featureRequest: Promise<void> | null = null;
  private _githubStarRequest: Promise<void> | null = null;
  private _markFeatureSeenRequest: Promise<void> | null = null;
  private _snapshot: RemindersSnapshot = {
    feature: null,
    showGithubStar: false,
  };

  constructor(
    @inject(REMINDERS_SERVICE) private readonly _requests: RemindersRequests
  ) {}

  readonly getSnapshot = (): RemindersSnapshot => this._snapshot;

  readonly subscribe = (listener: Listener): (() => void) => {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  };

  start(): void {
    if (this._active) return;
    this._active = true;
    this._lifecycle += 1;
  }

  stop(): void {
    if (!this._active) return;
    this._active = false;
    this._lifecycle += 1;
    this._dismissGithubStarRequest = null;
    this._featureRequest = null;
    this._githubStarRequest = null;
    this._markFeatureSeenRequest = null;
  }

  requestFeature(): Promise<void> {
    if (!this._active) return Promise.resolve();
    if (this._featureRequest !== null) return this._featureRequest;
    const lifecycle = this._lifecycle;
    this._featureRequest = this._settle(async () => {
      const feature = await this._requests.nextFeature();
      if (this._isCurrent(lifecycle) && feature !== null) {
        this._publish({ ...this._snapshot, feature });
      }
    });
    return this._featureRequest;
  }

  requestGithubStar(): Promise<void> {
    if (!this._active) return Promise.resolve();
    if (this._githubStarRequest !== null) return this._githubStarRequest;
    const lifecycle = this._lifecycle;
    this._githubStarRequest = this._settle(async () => {
      const result = await this._requests.shouldShowGithubStar();
      if (this._isCurrent(lifecycle) && result.show) {
        this._publish({ ...this._snapshot, showGithubStar: true });
      }
    });
    return this._githubStarRequest;
  }

  markFeatureSeen(): Promise<void> {
    if (!this._active) return Promise.resolve();
    if (this._snapshot.feature === null) return Promise.resolve();
    if (this._markFeatureSeenRequest !== null) {
      return this._markFeatureSeenRequest;
    }
    const id = this._snapshot.feature.id;
    this._markFeatureSeenRequest = this._settle(() =>
      this._requests.markFeatureSeen(id)
    );
    return this._markFeatureSeenRequest;
  }

  dismissGithubStarForever(): Promise<void> {
    if (!this._active) return Promise.resolve();
    if (this._dismissGithubStarRequest !== null) {
      return this._dismissGithubStarRequest;
    }
    this._dismissGithubStarRequest = this._settle(() =>
      this._requests.dismissGithubStarForever()
    );
    return this._dismissGithubStarRequest;
  }

  private async _settle(run: () => Promise<void>): Promise<void> {
    try {
      await run();
    } catch {
      // Passive reminders are optional and have no actionable error UI.
    }
  }

  private _isCurrent(lifecycle: number): boolean {
    return this._active && this._lifecycle === lifecycle;
  }

  private _publish(snapshot: RemindersSnapshot): void {
    this._snapshot = snapshot;
    for (const listener of this._listeners) listener();
  }
}
