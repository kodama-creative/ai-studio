import { inject, injectable } from "inversify";

import type { Event } from "../../shared/event";

import { WINDOW_CONTAINER_FACTORY } from "./window-container-factory";

export interface MainWindowHandle {
  activate(): void;
  close(): Promise<void> | void;
  readonly onDidClose: Event<void>;
}

export interface MainWindowFactory<T extends MainWindowHandle> {
  createMain(): Promise<T>;
}

/** Owns the at-most-one Main window invariant without owning process services. */
@injectable()
export class MainWindowManager<T extends MainWindowHandle = MainWindowHandle> {
  private _current: T | undefined;
  private _opening: Promise<T> | undefined;

  constructor(
    @inject(WINDOW_CONTAINER_FACTORY)
    private readonly _factory: MainWindowFactory<T>
  ) {}

  /** Create Main on demand, or activate the existing window. */
  open(): Promise<T> {
    if (this._current !== undefined) {
      this._current.activate();
      return Promise.resolve(this._current);
    }
    if (this._opening !== undefined) {
      return this._opening.then((handle) => {
        handle.activate();
        return handle;
      });
    }
    const opening = this._factory
      .createMain()
      .then((handle) => {
        // Store first because a terminal close event may replay synchronously.
        this._current = handle;
        handle.onDidClose(() => {
          if (this._current === handle) this._current = undefined;
        });
        return handle;
      })
      .finally(() => {
        if (this._opening === opening) this._opening = undefined;
      });
    this._opening = opening;
    return opening;
  }

  /** Return Main only while its native window is alive. */
  current(): T | undefined {
    return this._current;
  }

  /** Close Main without disposing any process-scoped Playground or Run. */
  async close(): Promise<void> {
    const opening = this._opening;
    if (opening !== undefined) await opening;
    const current = this._current;
    if (current === undefined) return;
    await current.close();
    if (this._current === current) this._current = undefined;
  }
}
