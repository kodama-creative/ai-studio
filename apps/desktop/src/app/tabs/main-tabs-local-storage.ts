import {
  LOCAL_STORAGE_KEYS,
  readLocalStorage,
  removeLocalStorage,
  writeLocalStorage,
} from "@llm-space/ui/lib/local-storage";
import { injectable } from "inversify";
import { z } from "zod";

import type {
  MainTabsPersistence,
  MainTabsStoredState,
} from "./main-tabs-controller";

const STORED_TABS_SCHEMA = z.array(
  z.object({
    type: z.literal("playground"),
    playgroundId: z.string(),
    title: z.string().optional(),
  })
);

/** Browser-local adapter for Main tab restoration state. */
@injectable()
export class MainTabsLocalStorage implements MainTabsPersistence {
  load(): MainTabsStoredState {
    try {
      const raw = readLocalStorage(LOCAL_STORAGE_KEYS.openAppTabs);
      return {
        tabs: raw === null ? [] : STORED_TABS_SCHEMA.parse(JSON.parse(raw)),
        activeId: readLocalStorage(LOCAL_STORAGE_KEYS.activeTab),
      };
    } catch {
      // Old file-backed or malformed tab state is intentionally not migrated.
      return { tabs: [], activeId: null };
    }
  }

  save(state: MainTabsStoredState): void {
    writeLocalStorage(
      LOCAL_STORAGE_KEYS.openAppTabs,
      JSON.stringify(state.tabs)
    );
    if (state.activeId === null) {
      removeLocalStorage(LOCAL_STORAGE_KEYS.activeTab);
    } else {
      writeLocalStorage(LOCAL_STORAGE_KEYS.activeTab, state.activeId);
    }
  }
}
