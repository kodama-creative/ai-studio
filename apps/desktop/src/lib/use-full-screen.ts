import { useEffect, useState } from "react";

import { windowClient } from "@/client/native-files";

/**
 * Track the window's OS-level (Electrobun) fullscreen state. Seeds the initial
 * value with an `isFullScreen` request, then stays in sync via the bun-pushed
 * `fullScreenChanged` messages.
 */
export function useFullScreen(): boolean {
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
      void subscription.dispose();
    };
  }, []);

  return fullScreen;
}
