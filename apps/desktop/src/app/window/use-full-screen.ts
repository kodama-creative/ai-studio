import { useController } from "@/app/di/react";

import { FullScreenController } from "./full-screen-controller";

/**
 * Track the window's OS-level (Electrobun) fullscreen state. Seeds the initial
 * value with an `isFullScreen` request, then stays in sync via the bun-pushed
 * `fullScreenChanged` messages.
 */
export function useFullScreen(): boolean {
  return useController(
    FullScreenController,
    (snapshot) => snapshot.fullScreen
  ).state;
}
