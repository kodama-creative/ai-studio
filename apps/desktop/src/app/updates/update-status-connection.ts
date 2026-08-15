import type { Disposable } from "@/shared/disposable";
import type { UpdateStatusChangedPayload } from "@/shared/updates";

import { disposeBestEffort } from "../lifecycle/dispose-best-effort";

export interface UpdateStatusConnectionOptions {
  readonly subscribeStatus: (
    listener: (payload: UpdateStatusChangedPayload) => void
  ) => Disposable;
  readonly takeInstalledVersion: () => Promise<string | null>;
  readonly onStatus: (payload: UpdateStatusChangedPayload) => void;
  readonly onInstalledVersion: (version: string) => void;
}

/**
 * Owns the renderer side of the passive update channel. It subscribes before
 * the startup read, invalidates stale completions, and contains teardown/read
 * failures because update UI must never destabilize the main application.
 */
export class UpdateStatusConnection {
  private _lifecycle = 0;
  private _subscription: Disposable | null = null;
  private _started = false;

  constructor(private readonly _options: UpdateStatusConnectionOptions) {}

  start(): void {
    this.stop();
    this._started = true;
    this._lifecycle += 1;
    const lifecycle = this._lifecycle;
    try {
      this._subscription = this._options.subscribeStatus((payload) => {
        if (this._isCurrent(lifecycle)) this._options.onStatus(payload);
      });
    } catch {
      // A missing update channel is non-fatal in dev and during teardown.
    }
    void this._options
      .takeInstalledVersion()
      .then((version) => {
        if (this._isCurrent(lifecycle) && version !== null) {
          this._options.onInstalledVersion(version);
        }
      })
      .catch(() => {
        // The startup acknowledgement is optional update UI state.
      });
  }

  stop(): void {
    this._started = false;
    this._lifecycle += 1;
    const subscription = this._subscription;
    this._subscription = null;
    disposeBestEffort(subscription);
  }

  private _isCurrent(lifecycle: number): boolean {
    return this._started && this._lifecycle === lifecycle;
  }
}
