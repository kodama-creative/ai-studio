import { useEffect, useMemo } from "react";

interface ClosableController {
  close(): void;
}

/**
 * Owns controller disposal for one committed React component lifetime.
 * React StrictMode's cleanup/setup probe can reattach during the same task;
 * a real unmount leaves no attachment when the disposal microtask runs.
 */
export class FinalControllerDisposal {
  private _activeAttachments = 0;
  private _disposed = false;

  constructor(private readonly _dispose: () => void) {}

  attach(): () => void {
    if (this._disposed) {
      throw new Error("Cannot attach a disposed controller.");
    }
    this._activeAttachments += 1;
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this._activeAttachments -= 1;
      queueMicrotask(() => {
        if (this._disposed || this._activeAttachments !== 0) return;
        this._disposed = true;
        this._dispose();
      });
    };
  }
}

/** Close a controller when its React owner is finally unmounted. */
export function useFinalControllerDisposal(controller: ClosableController): void {
  const disposal = useMemo(
    () => new FinalControllerDisposal(() => controller.close()),
    [controller]
  );
  useEffect(() => disposal.attach(), [disposal]);
}
