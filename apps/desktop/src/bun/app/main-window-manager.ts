import type {
  DesktopProcessContainer,
  DesktopWindowScope,
} from "../di/process-container";

export interface MainWindowHandle {
  activate(): void;
}

/** Owns the at-most-one Main window invariant without owning process services. */
export class MainWindowManager<T extends MainWindowHandle> {
  private _current:
    | { readonly handle: T; readonly scope: DesktopWindowScope }
    | undefined;
  private _opening: Promise<T> | undefined;

  constructor(
    private readonly _process: DesktopProcessContainer,
    private readonly _create: (scope: DesktopWindowScope) => Promise<T>
  ) {}

  /** Create Main on demand, or activate the existing window. */
  open(): Promise<T> {
    if (this._current !== undefined) {
      this._current.handle.activate();
      return Promise.resolve(this._current.handle);
    }
    if (this._opening !== undefined) {
      return this._opening.then((handle) => {
        handle.activate();
        return handle;
      });
    }
    const scope = this._process.createWindowScope("main");
    scope.onDisposed(() => {
      if (this._current?.scope === scope) this._current = undefined;
    });
    const opening = this._create(scope)
      .then((handle) => {
        if (scope.isDisposing) {
          throw new Error("Main window closed during creation.");
        }
        this._current = { handle, scope };
        return handle;
      })
      .catch(async (error: unknown) => {
        try {
          await scope.dispose();
        } catch (cleanupError) {
          console.error(
            "Failed to dispose Main window scope after creation failed:",
            cleanupError
          );
        }
        throw error;
      })
      .finally(() => {
        if (this._opening === opening) this._opening = undefined;
      });
    this._opening = opening;
    return opening;
  }

  /** Return Main only while its native window is alive. */
  current(): T | undefined {
    return this._current?.handle;
  }

  /** Close Main without disposing any process-scoped Playground or Run. */
  async close(): Promise<void> {
    const opening = this._opening;
    if (opening !== undefined) await opening;
    const current = this._current;
    if (current === undefined) return;
    await current.scope.dispose();
    if (this._current === current) this._current = undefined;
  }
}
