import type { GithubAuthState } from "@/shared/auth";

interface Subscription {
  dispose(): void | Promise<void>;
}

export interface GithubAuthControllerOptions {
  readonly getState: () => Promise<GithubAuthState>;
  readonly subscribeChanged: (
    listener: (state: GithubAuthState) => void
  ) => Subscription;
  readonly login: () => void;
  readonly logout: () => void;
  readonly notifyError: (message: string) => void;
}

type Listener = () => void;

/** Owns GitHub Account state precedence, subscription, and auth commands. */
export class GithubAuthController {
  private readonly _listeners = new Set<Listener>();
  private _eventRevision = 0;
  private _lifecycle = 0;
  private _snapshot: GithubAuthState = { status: "signedOut" };
  private _started = false;
  private _subscription: Subscription | null = null;

  constructor(private readonly _options: GithubAuthControllerOptions) {}

  readonly getSnapshot = (): GithubAuthState => this._snapshot;

  readonly subscribe = (listener: Listener): (() => void) => {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  };

  readonly signIn = (): void => {
    this._requireStarted();
    this._options.login();
  };

  readonly signOut = (): void => {
    this._requireStarted();
    this._options.logout();
  };

  start(): void {
    this.stop();
    this._started = true;
    this._lifecycle += 1;
    const lifecycle = this._lifecycle;
    const initialEventRevision = this._eventRevision;
    this._subscription = this._options.subscribeChanged((state) => {
      if (!this._isCurrent(lifecycle)) return;
      this._eventRevision += 1;
      this._publish(state);
    });
    void this._options
      .getState()
      .then((state) => {
        if (
          this._isCurrent(lifecycle) &&
          this._eventRevision === initialEventRevision
        ) {
          this._publish(state);
        }
      })
      .catch(() => {
        // A failed initial read is non-fatal; live events remain authoritative.
      });
  }

  stop(): void {
    this._started = false;
    this._lifecycle += 1;
    const subscription = this._subscription;
    this._subscription = null;
    if (subscription !== null) {
      try {
        void Promise.resolve(subscription.dispose()).catch(() => undefined);
      } catch {
        // Subscription cleanup is best-effort during renderer teardown.
      }
    }
  }

  private _publish(state: GithubAuthState): void {
    this._snapshot = state;
    for (const listener of this._listeners) listener();
    if (state.status === "signedOut" && state.error) {
      this._options.notifyError(state.error);
    }
  }

  private _isCurrent(lifecycle: number): boolean {
    return this._started && this._lifecycle === lifecycle;
  }

  private _requireStarted(): void {
    if (!this._started) {
      throw new Error("GithubAuthController must be started first.");
    }
  }
}
