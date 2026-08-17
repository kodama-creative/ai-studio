import { inject, injectable } from "inversify";

import { disposeBestEffort } from "@/app/lifecycle/dispose-best-effort";
import type { AgentProjectSummary } from "@/shared/agent-project";
import {
  AGENT_PROJECTS_SERVICE,
  type AgentProjectsRpc,
} from "@/shared/agent-project-rpc";
import type { Disposable } from "@/shared/disposable";
import type { RpcClient } from "@/shared/namespaced-rpc";

import { RendererNotificationService } from "../notifications/renderer-notification-service";

export interface AgentProjectCatalogSnapshot {
  readonly projects: readonly AgentProjectSummary[];
  readonly loading: boolean;
}

type Listener = () => void;

/**
 * Owns the Main window's known Agent Project catalog.
 *
 * Event subscriptions are established before the initial read, and every
 * change starts a newer read, so no catalog mutation can disappear in the
 * list/subscribe gap or be overwritten by an older response.
 */
@injectable()
export class AgentProjectCatalogController {
  private readonly _listeners = new Set<Listener>();
  private _lifecycle = 0;
  private _request = 0;
  private _started = false;
  private _subscriptions: readonly Disposable[] = [];
  private _snapshot: AgentProjectCatalogSnapshot = {
    projects: [],
    loading: true,
  };

  constructor(
    @inject(AGENT_PROJECTS_SERVICE)
    private readonly _projects: Pick<RpcClient<AgentProjectsRpc>, "list" | "on">,
    @inject(RendererNotificationService)
    private readonly _notifications: RendererNotificationService
  ) {}

  readonly getSnapshot = (): AgentProjectCatalogSnapshot => this._snapshot;

  readonly subscribe = (listener: Listener): (() => void) => {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  };

  /** Subscribe first, then read the initial authoritative catalog. */
  start(): void {
    if (this._started) this.stop();
    this._started = true;
    this._lifecycle += 1;
    const lifecycle = this._lifecycle;
    const subscriptions: Disposable[] = [];
    try {
      subscriptions.push(
        this._projects.on("changed", () => {
          if (!this._isActiveLifecycle(lifecycle)) return;
          void this.refresh();
        })
      );
      subscriptions.push(
        this._projects.on("openFailed", ({ message }) => {
          if (!this._isActiveLifecycle(lifecycle)) return;
          this._notifications.error(
            "Unable to open Agent Project",
            new Error(message)
          );
        })
      );
      this._subscriptions = subscriptions;
      this._setSnapshot({ ...this._snapshot, loading: true });
      void this.refresh();
    } catch (error) {
      for (const subscription of subscriptions.reverse()) {
        disposeBestEffort(subscription);
      }
      this._subscriptions = [];
      this._started = false;
      this._lifecycle += 1;
      this._setSnapshot({ ...this._snapshot, loading: false });
      this._notifications.error("Unable to watch Agent Projects", error);
    }
  }

  /** Dispose event ownership and invalidate every pending list response. */
  stop(): void {
    if (!this._started) return;
    this._started = false;
    this._lifecycle += 1;
    this._request += 1;
    for (const subscription of [...this._subscriptions].reverse()) {
      disposeBestEffort(subscription);
    }
    this._subscriptions = [];
  }

  /** Read the latest catalog; only the newest request may publish. */
  async refresh(): Promise<void> {
    if (!this._started) return;
    const lifecycle = this._lifecycle;
    const request = ++this._request;
    try {
      const projects = await this._projects.list();
      if (!this._isCurrent(lifecycle, request)) return;
      this._setSnapshot({ projects, loading: false });
    } catch (error) {
      if (!this._isCurrent(lifecycle, request)) return;
      this._setSnapshot({ ...this._snapshot, loading: false });
      this._notifications.error("Unable to refresh Agent Projects", error);
    }
  }

  private _isCurrent(lifecycle: number, request: number): boolean {
    return (
      this._isActiveLifecycle(lifecycle) &&
      this._request === request
    );
  }

  private _isActiveLifecycle(lifecycle: number): boolean {
    return this._started && this._lifecycle === lifecycle;
  }

  private _setSnapshot(snapshot: AgentProjectCatalogSnapshot): void {
    this._snapshot = snapshot;
    for (const listener of this._listeners) listener();
  }
}
