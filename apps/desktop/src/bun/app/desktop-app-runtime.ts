export interface DesktopAppCleanup {
  readonly name: string;
  readonly stop: () => Promise<void> | void;
}

/** Owns the idempotent, ordered top-level Desktop shutdown transaction. */
export class DesktopAppRuntime {
  private _stopPromise: Promise<void> | undefined;

  constructor(
    private readonly _cleanups: readonly DesktopAppCleanup[],
    private readonly _onStopError: (name: string, error: unknown) => void = (
      name,
      error
    ) => console.error(`Failed to stop ${name}:`, error)
  ) {}

  stop(): Promise<void> {
    this._stopPromise ??= this._stop();
    return this._stopPromise;
  }

  private async _stop(): Promise<void> {
    for (const cleanup of this._cleanups) {
      try {
        await cleanup.stop();
      } catch (error) {
        try {
          this._onStopError(cleanup.name, error);
        } catch (reportError) {
          console.error("Failed to report Desktop shutdown error:", reportError);
        }
      }
    }
  }
}
