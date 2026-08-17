import { inject, injectable } from "inversify";

import { disposeBestEffort } from "@/app/lifecycle/dispose-best-effort";
import type { Disposable } from "@/shared/disposable";
import { WINDOW_SERVICE } from "@/shared/window-rpc";

export interface FullScreenClient {
  getFullscreenState(): Promise<{ fullScreen: boolean }>;
  on(
    event: "fullScreenChanged",
    listener: (payload: { fullScreen: boolean }) => void
  ): Disposable;
}

export interface FullScreenSnapshot {
  readonly fullScreen: boolean;
}

type Listener = () => void;

const INITIAL_SNAPSHOT: FullScreenSnapshot = { fullScreen: false };

/**
 * Owns the renderer's native fullscreen projection. The live event stream is
 * subscribed before the initial read, and any event observed in that lifecycle
 * remains authoritative over a late read response.
 */
@injectable()
export class FullScreenController {
  private readonly _listeners = new Set<Listener>();
  private _lifecycle = 0;
  private _started = false;
  private _subscription: Disposable | null = null;
  private _snapshot: FullScreenSnapshot = INITIAL_SNAPSHOT;

  constructor(
    @inject(WINDOW_SERVICE) private readonly _client: FullScreenClient
  ) {}

  readonly getSnapshot = (): FullScreenSnapshot => this._snapshot;

  readonly subscribe = (listener: Listener): (() => void) => {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  };

  /** Subscribe first, then seed from RPC without overwriting a live event. */
  start(): void {
    if (this._started) {
      throw new Error("FullScreenController is already started.");
    }
    this._started = true;
    const lifecycle = ++this._lifecycle;
    let observedLiveEvent = false;

    try {
      this._subscription = this._client.on(
        "fullScreenChanged",
        ({ fullScreen }) => {
          if (!this._isCurrent(lifecycle)) return;
          observedLiveEvent = true;
          this._setSnapshot(fullScreen);
        }
      );
    } catch {
      // Fullscreen styling is optional; retain the read-only fallback below.
      this._subscription = null;
    }

    void Promise.resolve()
      .then(() => this._client.getFullscreenState())
      .then(({ fullScreen }) => {
        if (!this._isCurrent(lifecycle) || observedLiveEvent) return;
        this._setSnapshot(fullScreen);
      })
      .catch(() => {
        // Preserve the last known/default projection when the native read fails.
      });
  }

  /** Invalidate retained callbacks and dispose the native event subscription. */
  stop(): void {
    if (!this._started) return;
    this._started = false;
    this._lifecycle += 1;
    const subscription = this._subscription;
    this._subscription = null;
    disposeBestEffort(subscription);
  }

  private _isCurrent(lifecycle: number): boolean {
    return this._started && this._lifecycle === lifecycle;
  }

  private _setSnapshot(fullScreen: boolean): void {
    if (this._snapshot.fullScreen === fullScreen) return;
    this._snapshot = { fullScreen };
    for (const listener of this._listeners) listener();
  }
}
