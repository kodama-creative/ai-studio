import type { WindowState } from "@llm-space/core/server";
import type { BrowserWindow } from "electrobun/bun";

const SAVE_DEBOUNCE_MS = 300;

export interface WindowStatePersistenceStore {
  readonly state: WindowState;
  update(patch: Partial<WindowState>): Promise<void>;
  flush(): Promise<void>;
}

class WindowStateController {
  private _frameTimer: ReturnType<typeof setTimeout> | undefined;
  private _zoomTimer: ReturnType<typeof setTimeout> | undefined;
  private _desiredZoom: number;

  constructor(
    private readonly _window: BrowserWindow,
    private readonly _store: WindowStatePersistenceStore,
    options: {
      readonly isMaximized?: boolean;
      readonly isFullScreen?: boolean;
      readonly zoom: number;
      readonly onFullScreenChange: (fullScreen: boolean) => void;
    }
  ) {
    this._desiredZoom = options.zoom;
    this._restoreFrameMode(options);
    this._attachFramePersistence();
    this._attachZoomPersistence();
    this._attachFullScreenSync(options.onFullScreenChange);
  }

  saveZoom(zoom: number): void {
    this._desiredZoom = zoom;
    clearTimeout(this._zoomTimer);
    this._zoomTimer = setTimeout(() => {
      void this._store
        .update({ zoom: this._desiredZoom })
        .catch(_reportWindowStateError);
    }, SAVE_DEBOUNCE_MS);
  }

  async flush(): Promise<void> {
    clearTimeout(this._frameTimer);
    clearTimeout(this._zoomTimer);
    await this._persistFrame();
    await this._store.update({ zoom: this._desiredZoom });
    await this._store.flush();
  }

  private _restoreFrameMode(options: {
    readonly isMaximized?: boolean;
    readonly isFullScreen?: boolean;
  }): void {
    if (options.isFullScreen) this._window.setFullScreen(true);
    else if (options.isMaximized) this._window.maximize();
  }

  private _attachFramePersistence(): void {
    const scheduleSave = () => {
      clearTimeout(this._frameTimer);
      this._frameTimer = setTimeout(() => {
        void this._persistFrame().catch(_reportWindowStateError);
      }, SAVE_DEBOUNCE_MS);
    };
    this._window.on("move", scheduleSave);
    this._window.on("resize", scheduleSave);
  }

  private _attachZoomPersistence(): void {
    if (this._desiredZoom !== 1) this._window.setPageZoom(this._desiredZoom);
    this._window.webview?.on("dom-ready", () => {
      if (this._window.getPageZoom() !== this._desiredZoom) {
        this._window.setPageZoom(this._desiredZoom);
      }
    });
  }

  private _attachFullScreenSync(
    onChange: (fullScreen: boolean) => void
  ): void {
    let last = this._window.isFullScreen();
    onChange(last);
    this._window.on("resize", () => {
      const next = this._window.isFullScreen();
      if (next !== last) {
        last = next;
        onChange(next);
      }
    });
  }

  private _persistFrame(): Promise<void> {
    if (this._window.isFullScreen()) {
      return this._store.update({ isFullScreen: true });
    }
    if (this._window.isMaximized()) {
      return this._store.update({ isMaximized: true, isFullScreen: false });
    }
    return this._store.update({
      frame: this._window.getFrame(),
      isMaximized: false,
      isFullScreen: false,
    });
  }
}

/** Process-scoped owner of every window's independent state controller. */
export class WindowStateManager {
  private readonly _controllers = new Map<number, WindowStateController>();

  attach(
    win: BrowserWindow,
    options: {
      store: WindowStatePersistenceStore;
      isMaximized?: boolean;
      isFullScreen?: boolean;
      zoom?: number;
      onFullScreenChange: (fullScreen: boolean) => void;
    }
  ): void {
    const controller = new WindowStateController(win, options.store, {
      isMaximized: options.isMaximized,
      isFullScreen: options.isFullScreen,
      zoom: options.zoom ?? 1,
      onFullScreenChange: options.onFullScreenChange,
    });
    this._controllers.set(win.id, controller);
    win.on("close", () => {
      void controller
        .flush()
        .catch(_reportWindowStateError)
        .finally(() => this._controllers.delete(win.id));
    });
  }

  saveZoom(win: BrowserWindow, zoom: number): void {
    this._controllers.get(win.id)?.saveZoom(zoom);
  }

  async flush(): Promise<void> {
    await Promise.all(
      [...this._controllers.values()].map((controller) => controller.flush())
    );
  }
}

function _reportWindowStateError(error: unknown): void {
  console.error("Failed to persist window state:", error);
}
