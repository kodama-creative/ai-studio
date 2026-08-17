import { inject, injectable } from "inversify";

import { COMMAND_SERVICE, type CommandService } from "@/commands/command-service";
import type { GithubAuthState } from "@/shared/auth";
import {
  GITHUB_ACCOUNT_SERVICE,
  type GithubAccountRpc,
} from "@/shared/github-account-rpc";
import type { RpcClient } from "@/shared/namespaced-rpc";

import { disposeBestEffort } from "../lifecycle/dispose-best-effort";
import { RendererNotificationService } from "../notifications/renderer-notification-service";

interface Subscription {
  dispose(): void | Promise<void>;
}

type Listener = () => void;

/** Owns GitHub Account state precedence, subscription, and auth commands. */
@injectable()
export class GithubAuthController {
  private readonly _listeners = new Set<Listener>();
  private _eventRevision = 0;
  private _lifecycle = 0;
  private _snapshot: GithubAuthState = { status: "signedOut" };
  private _started = false;
  private _subscription: Subscription | null = null;

  constructor(
    @inject(GITHUB_ACCOUNT_SERVICE)
    private readonly _account: Pick<
      RpcClient<GithubAccountRpc>,
      "getState" | "on"
    >,
    @inject(COMMAND_SERVICE)
    private readonly _commands: CommandService,
    @inject(RendererNotificationService)
    private readonly _notifications: RendererNotificationService
  ) {}

  readonly getSnapshot = (): GithubAuthState => this._snapshot;

  readonly subscribe = (listener: Listener): (() => void) => {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  };

  readonly signIn = (): void => {
    this._requireStarted();
    this._commands.executeCommand({ type: "githubAccount.login", args: {} });
  };

  readonly signOut = (): void => {
    this._requireStarted();
    this._commands.executeCommand({ type: "githubAccount.logout", args: {} });
  };

  start(): void {
    this.stop();
    this._started = true;
    this._lifecycle += 1;
    const lifecycle = this._lifecycle;
    const initialEventRevision = this._eventRevision;
    this._subscription = this._account.on("changed", (state) => {
      if (!this._isCurrent(lifecycle)) return;
      this._eventRevision += 1;
      this._publish(state);
    });
    void this._account
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
    disposeBestEffort(subscription);
  }

  private _publish(state: GithubAuthState): void {
    this._snapshot = state;
    for (const listener of this._listeners) listener();
    if (state.status === "signedOut" && state.error) {
      this._notifications.error(state.error);
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
