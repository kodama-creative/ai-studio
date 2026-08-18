import type { WindowState } from "@llm-space/core/server";
import type { BrowserWindow } from "electrobun/bun";
import { injectable, preDestroy } from "inversify";

import { Emitter, type Event } from "../../shared/event";

const SAVE_DEBOUNCE_MS = 300;

export interface WindowStatePersistenceStore {
  readonly state: WindowState;
  update(patch: Partial<WindowState>): Promise<void>;
  flush(): Promise<void>;
}

/** Persist frame and zoom state for the one BrowserWindow in a child Container. */
@injectable()
export class WindowStateController {
  private readonly _didChangeFullScreen = new Emitter<boolean>();
  readonly onDidChangeFullScreen: Event<boolean> =
    this._didChangeFullScreen.event;

  private _window: BrowserWindow | undefined;
  private _store: WindowStatePersistenceStore | undefined;
  private _frameTimer: ReturnType<typeof setTimeout> | undefined;
  private _zoomTimer: ReturnType<typeof setTimeout> | undefined;
  private _desiredZoom = 1;
  private _disposed = false;
  private _disposePromise: Promise<void> | undefined;

  /** Attach exactly one native window and restore its persisted frame mode. */
  attach(
    window: BrowserWindow,
    store: WindowStatePersistenceStore,
    options: {
      readonly isMaximized?: boolean;
      readonly isFullScreen?: boolean;
      readonly zoom: number;
    }
  ): void {
    if (this._disposed) {
      throw new Error("Window state controller is disposed.");
    }
    if (this._window !== undefined) {
      throw new Error("Window state controller is already attached.");
    }
    this._window = window;
    this._store = store;
    this._desiredZoom = options.zoom;
    this._restoreFrameMode(options);
    this._attachFramePersistence();
    this._attachZoomPersistence();
    this._attachFullScreenSync();
  }

  /** Debounce persistence of a user-selected page zoom. */
  saveZoom(zoom: number): void {
    if (this._disposed) return;
    this._requireWindow();
    this._desiredZoom = zoom;
    clearTimeout(this._zoomTimer);
    this._zoomTimer = setTimeout(() => {
      if (this._disposed) return;
      void this._requireStore()
        .update({ zoom: this._desiredZoom })
        .catch(_reportWindowStateError);
    }, SAVE_DEBOUNCE_MS);
  }

  /** Flush this window's final frame and zoom before the native window closes. */
  @preDestroy()
  dispose(): Promise<void> {
    this._disposed = true;
    return (this._disposePromise ??= this._dispose());
  }

  private async _dispose(): Promise<void> {
    try {
      if (this._window === undefined || this._store === undefined) return;
      clearTimeout(this._frameTimer);
      clearTimeout(this._zoomTimer);
      await this._persistFrame();
      await this._store.update({ zoom: this._desiredZoom });
      await this._store.flush();
    } finally {
      this._didChangeFullScreen.dispose();
    }
  }

  private _restoreFrameMode(options: {
    readonly isMaximized?: boolean;
    readonly isFullScreen?: boolean;
  }): void {
    const window = this._requireWindow();
    if (options.isFullScreen) window.setFullScreen(true);
    else if (options.isMaximized) window.maximize();
  }

  private _attachFramePersistence(): void {
    const scheduleSave = () => {
      if (this._disposed) return;
      clearTimeout(this._frameTimer);
      this._frameTimer = setTimeout(() => {
        if (this._disposed) return;
        void this._persistFrame().catch(_reportWindowStateError);
      }, SAVE_DEBOUNCE_MS);
    };
    const window = this._requireWindow();
    window.on("move", scheduleSave);
    window.on("resize", scheduleSave);
  }

  private _attachZoomPersistence(): void {
    const window = this._requireWindow();
    if (this._desiredZoom !== 1) window.setPageZoom(this._desiredZoom);
    window.webview?.on("dom-ready", () => {
      if (this._disposed) return;
      if (window.getPageZoom() !== this._desiredZoom) {
        window.setPageZoom(this._desiredZoom);
      }
    });
  }

  private _attachFullScreenSync(): void {
    const window = this._requireWindow();
    let last = window.isFullScreen();
    this._didChangeFullScreen.fire(last);
    window.on("resize", () => {
      if (this._disposed) return;
      const next = window.isFullScreen();
      if (next !== last) {
        last = next;
        this._didChangeFullScreen.fire(next);
      }
    });
  }

  private _persistFrame(): Promise<void> {
    const window = this._requireWindow();
    const store = this._requireStore();
    if (window.isFullScreen()) {
      return store.update({ isFullScreen: true });
    }
    if (window.isMaximized()) {
      return store.update({ isMaximized: true, isFullScreen: false });
    }
    const frame = window.getFrame();
    // CEF reports a terminal 0x0 frame after renderer-initiated close has
    // already begun. Keep the last valid frame instead of corrupting shutdown.
    if (
      !Number.isFinite(frame.x) ||
      !Number.isFinite(frame.y) ||
      !Number.isFinite(frame.width) ||
      !Number.isFinite(frame.height) ||
      frame.width <= 0 ||
      frame.height <= 0
    ) {
      return Promise.resolve();
    }
    return store.update({
      frame,
      isMaximized: false,
      isFullScreen: false,
    });
  }

  private _requireWindow(): BrowserWindow {
    if (this._window === undefined) {
      throw new Error("Window state controller is not attached.");
    }
    return this._window;
  }

  private _requireStore(): WindowStatePersistenceStore {
    if (this._store === undefined) {
      throw new Error("Window state store is not attached.");
    }
    return this._store;
  }
}

function _reportWindowStateError(error: unknown): void {
  console.error("Failed to persist window state:", error);
}
