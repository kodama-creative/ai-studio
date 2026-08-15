import { useEffect, useSyncExternalStore } from "react";

import type {
  MainTabsController,
  MainTabsSnapshot,
} from "./main-tabs-controller";

/** React adapter: controller owns behavior; React subscribes to its snapshot. */
export function useMainTabs(controller: MainTabsController): MainTabsSnapshot {
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot
  );
  useEffect(() => {
    controller.start();
    return () => controller.stop();
  }, [controller]);
  return snapshot;
}
