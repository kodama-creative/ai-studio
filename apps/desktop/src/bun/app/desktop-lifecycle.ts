type Cleanup = () => Promise<void> | void;

/** Minimal process handle retained by the Electrobun shutdown coordinator. */
export interface DesktopAppRuntime {
  stop(): Promise<void>;
}

/**
 * Own one LIFO stack of Desktop resources.
 *
 * Callers register immediately after construction; shutdown then mirrors
 * ownership in reverse without letting one cleanup failure skip the rest.
 */
export class DesktopLifecycle implements DesktopAppRuntime {
  private readonly _cleanups: { readonly name: string; readonly run: Cleanup }[] =
    [];
  private _stopPromise: Promise<void> | undefined;

  constructor(
    private readonly _onStopError: (name: string, error: unknown) => void = (
      name,
      error
    ) => console.error(`Failed to stop ${name}:`, error)
  ) {}

  /** Register immediately after construction; cleanup runs in reverse order. */
  defer(name: string, cleanup: Cleanup): void {
    if (this._stopPromise !== undefined) {
      throw new Error("Desktop lifecycle is already stopping.");
    }
    this._cleanups.push({ name, run: cleanup });
  }

  /** Run every cleanup once, reporting failures without skipping later owners. */
  stop(): Promise<void> {
    this._stopPromise ??= this._stop();
    return this._stopPromise;
  }

  private async _stop(): Promise<void> {
    for (const cleanup of this._cleanups.reverse()) {
      try {
        await cleanup.run();
      } catch (error) {
        try {
          this._onStopError(cleanup.name, error);
        } catch (reportError) {
          console.error("Failed to report Desktop shutdown error:", reportError);
        }
      }
    }
    this._cleanups.length = 0;
  }
}
