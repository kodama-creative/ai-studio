import type { StudioThread } from "@llm-space/studio";
import { inject, injectable } from "inversify";

import {
  ProjectSourceController,
  type ProjectSourceControllerSnapshot,
} from "./project-source-controller";
import {
  ProjectThreadsController,
  type ProjectThreadsSnapshot,
} from "./project-threads-controller";

export type ProjectTab =
  | {
      readonly id: string;
      readonly type: "thread";
      readonly threadId: string;
      readonly title: string;
    }
  | {
      readonly id: string;
      readonly type: "code";
      readonly path: string;
      readonly title: string;
    };

export interface ProjectWorkspaceSnapshot {
  readonly tabs: readonly ProjectTab[];
  readonly activeTabId?: string;
  readonly threads: ProjectThreadsSnapshot;
  readonly source: ProjectSourceControllerSnapshot;
}

type Listener = () => void;

/**
 * Owns one Project window's navigable workspace.
 *
 * Thread and source controllers remain internal implementation modules. The
 * workspace owns the selection epoch shared by both, so an older async open
 * can never steal focus from a newer selection of the other resource kind.
 */
@injectable()
export class ProjectWorkspaceController {
  private readonly _listeners = new Set<Listener>();
  private _activeTabId?: string;
  private _lifecycle = 0;
  private _selection = 0;
  private _started = false;
  private _tabs: readonly ProjectTab[] = [];
  private _snapshot: ProjectWorkspaceSnapshot;

  constructor(
    @inject(ProjectThreadsController)
    private readonly _threads: ProjectThreadsController,
    @inject(ProjectSourceController)
    private readonly _source: ProjectSourceController
  ) {
    this._snapshot = this._composeSnapshot();
    this._threads.subscribe(this._acceptChildSnapshot);
    this._source.subscribe(this._acceptChildSnapshot);
  }

  readonly getSnapshot = (): ProjectWorkspaceSnapshot => this._snapshot;

  readonly subscribe = (listener: Listener): (() => void) => {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  };

  /** Start both Project data owners and select the first durable Thread. */
  start(): void {
    if (this._started) this.stop();
    this._started = true;
    const lifecycle = ++this._lifecycle;
    const selection = this._beginSelection();
    this._source.start();
    void this._threads.start().then((thread) => {
      if (
        thread !== undefined &&
        this._isCurrentSelection(lifecycle, selection)
      ) {
        this._activateThread(thread);
      }
    });
  }

  /** Stop both child lifecycles and invalidate all pending navigation. */
  stop(): void {
    if (!this._started) return;
    this._started = false;
    this._lifecycle += 1;
    this._selection += 1;
    this._threads.stop();
    this._source.stop();
  }

  /** Open and select a durable Thread if this remains the latest navigation. */
  readonly openThread = async (threadId: string): Promise<void> => {
    this._requireStarted();
    const lifecycle = this._lifecycle;
    const selection = this._beginSelection();
    const thread = await this._threads.open(threadId);
    if (
      thread !== undefined &&
      this._isCurrentSelection(lifecycle, selection)
    ) {
      this._activateThread(thread);
    }
  };

  /** Create and select a Thread without allowing stale completion to focus it. */
  readonly createThread = async (): Promise<void> => {
    this._requireStarted();
    const lifecycle = this._lifecycle;
    const selection = this._beginSelection();
    const thread = await this._threads.create();
    if (
      thread !== undefined &&
      this._isCurrentSelection(lifecycle, selection)
    ) {
      this._activateThread(thread);
    }
  };

  /** Fork and select a Thread without allowing stale completion to focus it. */
  readonly forkThread = async (
    threadId: string,
    entryId?: string
  ): Promise<void> => {
    this._requireStarted();
    const lifecycle = this._lifecycle;
    const selection = this._beginSelection();
    const thread = await this._threads.fork(threadId, entryId);
    if (
      thread !== undefined &&
      this._isCurrentSelection(lifecycle, selection)
    ) {
      this._activateThread(thread);
    }
  };

  /** Open and select a source document if this remains the latest navigation. */
  readonly openSourceFile = async (path: string): Promise<void> => {
    this._requireStarted();
    const lifecycle = this._lifecycle;
    const selection = this._beginSelection();
    if (
      (await this._source.open(path)) &&
      this._isCurrentSelection(lifecycle, selection)
    ) {
      this._activateSource(path);
    }
  };

  /** Select an existing tab and make its Thread the active Studio projection. */
  readonly selectTab = (tabId: string): void => {
    this._requireStarted();
    const tab = this._tabs.find((candidate) => candidate.id === tabId);
    if (tab === undefined) return;
    const lifecycle = this._lifecycle;
    const selection = this._beginSelection();
    this._activeTabId = tab.id;
    this._publish();
    if (
      tab.type === "thread" &&
      this._threads.getSnapshot().activeThread?.id !== tab.threadId
    ) {
      void this._threads.open(tab.threadId).then((thread) => {
        if (
          thread !== undefined &&
          this._isCurrentSelection(lifecycle, selection)
        ) {
          this._syncThreadTitles();
        }
      });
    }
  };

  /** Close one tab and select its nearest surviving sibling. */
  readonly closeTab = (tabId: string): void => {
    this._requireStarted();
    const index = this._tabs.findIndex((tab) => tab.id === tabId);
    if (index === -1) return;
    const closing = this._tabs[index];
    if (closing?.type === "code") this._source.close(closing.path);
    this._tabs = this._tabs.filter((tab) => tab.id !== tabId);
    if (this._activeTabId !== tabId) {
      this._publish();
      return;
    }
    const next = this._tabs[Math.min(index, this._tabs.length - 1)];
    this._activeTabId = undefined;
    if (next === undefined) {
      this._beginSelection();
      this._publish();
      return;
    }
    this._publish();
    this.selectTab(next.id);
  };

  /** Accept the latest durable projection from the active Thread pane. */
  readonly acceptThreadProjection = (thread: StudioThread): void => {
    this._threads.acceptThreadProjection(thread);
  };

  /** Refresh Thread collection metadata after a run settles. */
  readonly refreshThreads = (): Promise<void> => this._threads.refresh();

  private readonly _acceptChildSnapshot = (): void => {
    this._syncThreadTitles();
  };

  private _activateThread(thread: StudioThread): void {
    const id = `thread:${thread.id}`;
    const existing = this._tabs.find((tab) => tab.id === id);
    this._tabs =
      existing === undefined
        ? [
            ...this._tabs,
            {
              id,
              type: "thread",
              threadId: thread.id,
              title: thread.document.title,
            },
          ]
        : this._tabs.map((tab) =>
            tab.id === id ? { ...tab, title: thread.document.title } : tab
          );
    this._activeTabId = id;
    this._publish();
  }

  private _activateSource(path: string): void {
    const id = `code:${path}`;
    if (!this._tabs.some((tab) => tab.id === id)) {
      this._tabs = [
        ...this._tabs,
        {
          id,
          type: "code",
          path,
          title: path.split("/").at(-1) ?? path,
        },
      ];
    }
    this._activeTabId = id;
    this._publish();
  }

  private _syncThreadTitles(): void {
    const threads = this._threads.getSnapshot();
    const byId = new Map(threads.threads.map((thread) => [thread.id, thread]));
    if (threads.activeThread !== undefined) {
      byId.set(threads.activeThread.id, threads.activeThread);
    }
    let changed = false;
    const tabs = this._tabs.map((tab) => {
      if (tab.type !== "thread") return tab;
      const title = byId.get(tab.threadId)?.document.title;
      if (title === undefined || title === tab.title) return tab;
      changed = true;
      return { ...tab, title };
    });
    if (changed) this._tabs = tabs;
    this._publish();
  }

  private _beginSelection(): number {
    return ++this._selection;
  }

  private _isCurrentSelection(lifecycle: number, selection: number): boolean {
    return (
      this._started &&
      this._lifecycle === lifecycle &&
      this._selection === selection
    );
  }

  private _composeSnapshot(): ProjectWorkspaceSnapshot {
    return {
      tabs: this._tabs,
      activeTabId: this._activeTabId,
      threads: this._threads.getSnapshot(),
      source: this._source.getSnapshot(),
    };
  }

  private _publish(): void {
    this._snapshot = this._composeSnapshot();
    for (const listener of this._listeners) listener();
  }

  private _requireStarted(): void {
    if (!this._started) {
      throw new Error("ProjectWorkspaceController must be started first.");
    }
  }
}
