import { useEffect, useMemo, useState } from "react";

import { disposeBestEffort } from "@/app/lifecycle/dispose-best-effort";
import { createWindowClient } from "@/client/window";

/**
 * Track the window's OS-level (Electrobun) fullscreen state. Seeds the initial
 * value with an `isFullScreen` request, then stays in sync via the bun-pushed
 * `fullScreenChanged` messages.
 */
export function useFullScreen(): boolean {
  const windowClient = useMemo(() => createWindowClient(), []);
  const [fullScreen, setFullScreen] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void windowClient
      .getFullscreenState()
      .then((res) => {
        if (!cancelled) setFullScreen(res.fullScreen);
      })
      .catch(() => {
        // Ignore: fall back to the default (not fullscreen).
      });

    const onChange = ({ fullScreen }: { fullScreen: boolean }) =>
      setFullScreen(fullScreen);
    const subscription = windowClient.on("fullScreenChanged", onChange);
    return () => {
      cancelled = true;
      disposeBestEffort(subscription);
    };
  }, [windowClient]);

  return fullScreen;
}
