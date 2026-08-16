import { FULL_SCREEN_CONTROLLER } from "@/app/di/common-module";
import { useController } from "@/app/di/react";

/**
 * Track the window's OS-level (Electrobun) fullscreen state. Seeds the initial
 * value with an `isFullScreen` request, then stays in sync via the bun-pushed
 * `fullScreenChanged` messages.
 */
export function useFullScreen(): boolean {
  return useController(
    FULL_SCREEN_CONTROLLER,
    (snapshot) => snapshot.fullScreen
  ).state;
}
