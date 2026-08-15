type Cleanup = () => Promise<void> | void;

/** Own process-level external resources that are not native DI disposables. */
export class DesktopProcessLifecycle {
  private readonly _cleanups: { readonly name: string; readonly run: Cleanup }[] =
    [];
  private _disposePromise: Promise<void> | undefined;

  /** Register immediately after construction; cleanup runs in reverse order. */
  defer(name: string, cleanup: Cleanup): void {
    if (this._disposePromise !== undefined) {
      throw new Error("Desktop process lifecycle is already disposing.");
    }
    this._cleanups.push({ name, run: cleanup });
  }

  /** Run every cleanup once, reporting failures without skipping later owners. */
  dispose(): Promise<void> {
    this._disposePromise ??= this._dispose();
    return this._disposePromise;
  }

  private async _dispose(): Promise<void> {
    for (const cleanup of this._cleanups.reverse()) {
      try {
        await cleanup.run();
      } catch (error) {
        console.error(`Failed to stop ${cleanup.name}:`, error);
      }
    }
    this._cleanups.length = 0;
  }
}
