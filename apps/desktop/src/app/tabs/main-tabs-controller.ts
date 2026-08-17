import { uuid } from "@llm-space/core";
import { inject, injectable } from "inversify";

import {
  PLAYGROUND_SERVICE,
  type PlaygroundClient,
} from "@/shared/playground-rpc";


/** One open Main-window tab backed exclusively by a durable Playground. */
export interface PlaygroundTab {
  readonly id: string;
  readonly type: "playground";
  readonly playgroundId: string;
  readonly title: string;
  readonly paneId: string;
  readonly refreshNonce?: number;
}

export type AppTab = PlaygroundTab;

export interface StoredPlaygroundTab {
  readonly type: "playground";
  readonly playgroundId: string;
  readonly title?: string;
}

export interface MainTabsStoredState {
  readonly tabs: readonly StoredPlaygroundTab[];
  readonly activeId: string | null;
}

export interface MainTabsPersistence {
  load(): MainTabsStoredState;
  save(state: MainTabsStoredState): void;
}

export const MAIN_TABS_PERSISTENCE = Symbol("MainTabsPersistence");

export const MAIN_TABS_ACTIVITY = Symbol("MainTabsActivity");

export interface MainTabsActivity {
  canPruneRestoredTab(tab: AppTab): boolean;
  subscribe(listener: () => void): () => void;
}

export interface MainTabsSnapshot {
  readonly tabs: readonly AppTab[];
  readonly activeId: string | null;
}

export type MainTabsIntent =
  | {
      readonly type: "open";
      readonly playgroundId: string;
      readonly title: string;
    }
  | { readonly type: "activate"; readonly id: string }
  | { readonly type: "activateSibling"; readonly offset: 1 | -1 }
  | { readonly type: "close"; readonly id: string }
  | { readonly type: "closeOthers"; readonly keepId: string }
  | { readonly type: "closeAll" }
  | { readonly type: "reorder"; readonly from: number; readonly to: number }
  | { readonly type: "refresh"; readonly id: string }
  | {
      readonly type: "renamePlayground";
      readonly playgroundId: string;
      readonly title: string;
    }
  | { readonly type: "reopenClosed" };

type Listener = () => void;
type PlaygroundExistence = "exists" | "missing" | "unknown";

/**
 * Owns Main-window tab identity, persistence, restoration, and close/reopen
 * ordering behind one snapshot + intent interface.
 */
@injectable()
export class MainTabsController {
  private readonly _listeners = new Set<Listener>();
  private readonly _closedStack: StoredPlaygroundTab[][] = [];
  private readonly _deferredInvalidPaneIds = new Set<string>();
  private _activation = 0;
  private _lifecycle = 0;
  private _mutation = 0;
  private _started = false;
  private _reopenChain = Promise.resolve();
  private _pruneSubscription: (() => void) | null = null;
  private _snapshot: MainTabsSnapshot;

  constructor(
    @inject(MAIN_TABS_PERSISTENCE)
    private readonly _persistence: MainTabsPersistence,
    @inject(PLAYGROUND_SERVICE)
    private readonly _playgrounds: Pick<PlaygroundClient, "load">,
    @inject(MAIN_TABS_ACTIVITY)
    private readonly _activity: MainTabsActivity
  ) {
    let stored: MainTabsStoredState = { tabs: [], activeId: null };
    try {
      stored = this._persistence.load();
    } catch {
      // Tab restoration is best-effort; an unavailable browser store must not
      // prevent the Main window from opening.
    }
    const tabs = _dedupe(stored.tabs.map(_fromStored));
    this._snapshot = {
      tabs,
      activeId: _validActiveId(tabs, stored.activeId),
    };
  }

  readonly getSnapshot = (): MainTabsSnapshot => this._snapshot;

  readonly subscribe = (listener: Listener): (() => void) => {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  };

  /** Validate the current restored pane identities against durable Playgrounds. */
  start(): void {
    if (this._started) this.stop();
    this._lifecycle += 1;
    try {
      this._pruneSubscription = this._activity.subscribe(() =>
        this._retryDeferredPruning()
      );
    } catch (error) {
      this._pruneSubscription = null;
      throw error;
    }
    this._started = true;
    const lifecycle = this._lifecycle;
    const restored = [...this._snapshot.tabs];
    if (restored.length > 0) void this._validateRestored(lifecycle, restored);
  }

  /** Invalidate asynchronous restoration and reopen work. */
  stop(): void {
    if (!this._started) return;
    this._started = false;
    this._lifecycle += 1;
    this._deferredInvalidPaneIds.clear();
    this._reopenChain = Promise.resolve();
    try {
      this._pruneSubscription?.();
    } catch {
      // Renderer teardown remains best-effort.
    }
    this._pruneSubscription = null;
  }

  /** Apply one typed user intent; asynchronous reopen work stays module-owned. */
  readonly dispatch = (intent: MainTabsIntent): void => {
    switch (intent.type) {
      case "open":
        this._open(intent.playgroundId, intent.title);
        return;
      case "activate":
        this._activate(intent.id);
        return;
      case "activateSibling":
        this._activateSibling(intent.offset);
        return;
      case "close":
        this._close(intent.id);
        return;
      case "closeOthers":
        this._closeOthers(intent.keepId);
        return;
      case "closeAll":
        this._closeAll();
        return;
      case "reorder":
        this._reorder(intent.from, intent.to);
        return;
      case "refresh":
        this._refresh(intent.id);
        return;
      case "renamePlayground":
        this._renamePlayground(intent.playgroundId, intent.title);
        return;
      case "reopenClosed": {
        const reopen = this._reopenChain.then(() => this._reopenClosed());
        this._reopenChain = reopen.catch(() => undefined);
        return;
      }
    }
  };

  private _open(playgroundId: string, title: string): void {
    this._mutation += 1;
    const id = _tabId(playgroundId);
    const existing = this._snapshot.tabs.find((tab) => tab.id === id);
    const tabs =
      existing === undefined
        ? [...this._snapshot.tabs, _createTab(playgroundId, title)]
        : this._snapshot.tabs.map((tab) =>
            tab.id === id ? { ...tab, title } : tab
          );
    this._publish(tabs, id);
  }

  private _activate(id: string): void {
    if (!this._snapshot.tabs.some((tab) => tab.id === id)) return;
    this._activation += 1;
    this._publish(this._snapshot.tabs, id);
  }

  private _activateSibling(offset: 1 | -1): void {
    const tabs = this._snapshot.tabs;
    if (tabs.length === 0) return;
    const index = tabs.findIndex((tab) => tab.id === this._snapshot.activeId);
    const nextIndex =
      index === -1
        ? offset === 1
          ? 0
          : tabs.length - 1
        : (index + offset + tabs.length) % tabs.length;
    const activeId = tabs[nextIndex]?.id ?? null;
    this._activation += 1;
    this._publish(tabs, activeId);
  }

  private _close(id: string): void {
    const index = this._snapshot.tabs.findIndex((tab) => tab.id === id);
    if (index === -1) return;
    this._mutation += 1;
    const closed = this._snapshot.tabs[index];
    const tabs = this._snapshot.tabs.filter((tab) => tab.id !== id);
    if (closed !== undefined) this._pushClosed([closed]);
    const activeId =
      this._snapshot.activeId === id
        ? (tabs[index - 1]?.id ?? tabs[index]?.id ?? null)
        : _validActiveId(tabs, this._snapshot.activeId);
    this._publish(tabs, activeId);
  }

  private _closeOthers(keepId: string): void {
    if (!this._snapshot.tabs.some((tab) => tab.id === keepId)) return;
    const closed = this._snapshot.tabs.filter((tab) => tab.id !== keepId);
    if (closed.length === 0) {
      this._activate(keepId);
      return;
    }
    this._mutation += 1;
    this._pushClosed(closed);
    this._publish(
      this._snapshot.tabs.filter((tab) => tab.id === keepId),
      keepId
    );
  }

  private _closeAll(): void {
    if (this._snapshot.tabs.length === 0) return;
    this._mutation += 1;
    this._pushClosed(this._snapshot.tabs);
    this._publish([], null);
  }

  private _reorder(from: number, to: number): void {
    const current = this._snapshot.tabs;
    if (
      from === to ||
      from < 0 ||
      to < 0 ||
      from >= current.length ||
      to >= current.length
    ) {
      return;
    }
    const tabs = [...current];
    const [moved] = tabs.splice(from, 1) as [AppTab];
    tabs.splice(to, 0, moved);
    this._publish(tabs, this._snapshot.activeId);
  }

  private _refresh(id: string): void {
    if (!this._snapshot.tabs.some((tab) => tab.id === id)) return;
    this._publish(
      this._snapshot.tabs.map((tab) =>
        tab.id === id
          ? { ...tab, refreshNonce: (tab.refreshNonce ?? 0) + 1 }
          : tab
      ),
      this._snapshot.activeId
    );
  }

  private _renamePlayground(playgroundId: string, title: string): void {
    if (!this._snapshot.tabs.some((tab) => tab.playgroundId === playgroundId)) {
      return;
    }
    this._publish(
      this._snapshot.tabs.map((tab) =>
        tab.playgroundId === playgroundId ? { ...tab, title } : tab
      ),
      this._snapshot.activeId
    );
  }

  private async _validateRestored(
    lifecycle: number,
    restored: readonly AppTab[]
  ): Promise<void> {
    const checked = await Promise.all(
      restored.map(async (tab) =>
        (await this._checkPlayground(tab.playgroundId)) === "missing"
          ? tab.paneId
          : null
      )
    );
    if (!this._isCurrentLifecycle(lifecycle)) return;
    const invalidPaneIds = new Set(
      checked.filter((paneId): paneId is string => paneId !== null)
    );
    if (invalidPaneIds.size === 0) return;
    const tabs = this._snapshot.tabs.filter((tab) => {
      if (!invalidPaneIds.has(tab.paneId)) return true;
      if (this._activity.canPruneRestoredTab(tab)) return false;
      this._deferredInvalidPaneIds.add(tab.paneId);
      return true;
    });
    if (tabs.length === this._snapshot.tabs.length) return;
    this._mutation += 1;
    this._publish(tabs, _validActiveId(tabs, this._snapshot.activeId));
  }

  private _retryDeferredPruning(): void {
    if (!this._started || this._deferredInvalidPaneIds.size === 0) return;
    const removablePaneIds = new Set<string>();
    for (const paneId of this._deferredInvalidPaneIds) {
      const tab = this._snapshot.tabs.find(
        (candidate) => candidate.paneId === paneId
      );
      if (tab === undefined) {
        this._deferredInvalidPaneIds.delete(paneId);
      } else if (this._activity.canPruneRestoredTab(tab)) {
        this._deferredInvalidPaneIds.delete(paneId);
        removablePaneIds.add(paneId);
      }
    }
    if (removablePaneIds.size === 0) return;
    this._mutation += 1;
    const tabs = this._snapshot.tabs.filter(
      (tab) => !removablePaneIds.has(tab.paneId)
    );
    this._publish(tabs, _validActiveId(tabs, this._snapshot.activeId));
  }

  private async _reopenClosed(): Promise<void> {
    if (!this._started) return;
    const group = this._closedStack.pop();
    if (group === undefined) return;
    const insertionIndex = this._closedStack.length;
    const lifecycle = this._lifecycle;
    const mutation = this._mutation;
    const activation = this._activation;
    const candidates = group.map(_fromStored);
    const checked = await Promise.all(
      candidates.map(async (tab) => ({
        tab,
        existence: await this._checkPlayground(tab.playgroundId),
      }))
    );
    if (!this._isCurrentLifecycle(lifecycle) || this._mutation !== mutation) {
      this._restoreClosedGroup(group, insertionIndex);
      return;
    }
    if (checked.some(({ existence }) => existence === "unknown")) {
      this._restoreClosedGroup(group, insertionIndex);
      return;
    }
    const alive = checked.flatMap(({ tab, existence }) =>
      existence === "exists" ? [tab] : []
    );
    if (alive.length === 0) return;
    this._mutation += 1;
    const tabs = _dedupe([...this._snapshot.tabs, ...alive]);
    this._publish(
      tabs,
      this._activation === activation
        ? (alive.at(-1)?.id ?? this._snapshot.activeId)
        : this._snapshot.activeId
    );
  }

  private async _checkPlayground(
    playgroundId: string
  ): Promise<PlaygroundExistence> {
    try {
      return (await this._playgrounds.load(playgroundId)) !== undefined
        ? "exists"
        : "missing";
    } catch {
      return "unknown";
    }
  }

  private _restoreClosedGroup(
    group: StoredPlaygroundTab[],
    insertionIndex: number
  ): void {
    this._closedStack.splice(
      Math.min(insertionIndex, this._closedStack.length),
      0,
      group
    );
  }

  private _pushClosed(tabs: readonly AppTab[]): void {
    if (tabs.length > 0) this._closedStack.push(tabs.map(_toStored));
  }

  private _isCurrentLifecycle(lifecycle: number): boolean {
    return this._started && this._lifecycle === lifecycle;
  }

  private _publish(tabs: readonly AppTab[], activeId: string | null): void {
    this._snapshot = {
      tabs,
      activeId: _validActiveId(tabs, activeId),
    };
    try {
      this._persistence.save({
        tabs: tabs.map(_toStored),
        activeId: this._snapshot.activeId,
      });
    } catch {
      // The live tab owner remains authoritative when browser persistence is
      // unavailable; later mutations get another chance to persist it.
    }
    for (const listener of this._listeners) listener();
  }
}

function _tabId(playgroundId: string): string {
  return `playground:${playgroundId}`;
}

function _createTab(playgroundId: string, title: string): PlaygroundTab {
  return {
    id: _tabId(playgroundId),
    type: "playground",
    playgroundId,
    title,
    paneId: `playground-pane:${uuid()}`,
  };
}

function _toStored(tab: AppTab): StoredPlaygroundTab {
  return {
    type: "playground",
    playgroundId: tab.playgroundId,
    title: tab.title,
  };
}

function _fromStored(tab: StoredPlaygroundTab): PlaygroundTab {
  return _createTab(tab.playgroundId, tab.title?.trim() || "Playground");
}

function _dedupe(tabs: readonly AppTab[]): readonly AppTab[] {
  const seen = new Set<string>();
  return tabs.filter((tab) => {
    if (seen.has(tab.id)) return false;
    seen.add(tab.id);
    return true;
  });
}

function _validActiveId(
  tabs: readonly AppTab[],
  preferred: string | null
): string | null {
  return preferred !== null && tabs.some((tab) => tab.id === preferred)
    ? preferred
    : (tabs[0]?.id ?? null);
}
