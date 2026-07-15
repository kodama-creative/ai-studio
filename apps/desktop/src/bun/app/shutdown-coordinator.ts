export interface BeforeQuitEvent {
  response?: { allow: boolean; };
}

/**
 * Turn Electrobun's synchronous, cancellable quit event into an awaited
 * two-phase shutdown. The first quit is cancelled while cleanup runs; the
 * second quit is allowed through after cleanup settles.
 */
export function createShutdownCoordinator({
  quit,
  stop,
  onStopError = error => { console.error("Desktop shutdown failed:", error); }
}: {
  onStopError?: (error: Error) => void;
  quit: () => void;
  stop: () => Promise<void>;
}): (event: BeforeQuitEvent) => void {
  let state: "idle" | "stopped" | "stopping" = "idle";

  return event => {
    if (state === "stopped") {
      return;
    }

    event.response = { allow: false };
    if (state === "stopping") {
      return;
    }

    state = "stopping";
    void stop()
      .catch(error => { onStopError(error instanceof Error ? error : new Error(String(error))); })
      .finally(() => {
        state = "stopped";
        quit();
      });
  };
}
