import { useEffect, useMemo, useSyncExternalStore } from "react";

import { createWindowClient } from "@/client/window";

import { FullScreenController } from "./full-screen-controller";

/**
 * Track the window's OS-level (Electrobun) fullscreen state. Seeds the initial
 * value with an `isFullScreen` request, then stays in sync via the bun-pushed
 * `fullScreenChanged` messages.
 */
export function useFullScreen(): boolean {
  const windowClient = useMemo(() => createWindowClient(), []);
  const controller = useMemo(
    () => new FullScreenController(windowClient),
    [windowClient]
  );
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot
  );

  useEffect(() => {
    controller.start();
    return () => controller.stop();
  }, [controller]);

  return snapshot.fullScreen;
}
