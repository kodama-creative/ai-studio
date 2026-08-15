import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { createRemindersClient } from "@/client/reminders";

import {
  RemindersController,
  type RemindersSnapshot,
} from "./reminders-controller";

interface RemindersValue extends RemindersSnapshot {
  readonly requestFeature: () => Promise<void>;
  readonly requestGithubStar: () => Promise<void>;
  readonly markFeatureSeen: () => Promise<void>;
  readonly dismissGithubStarForever: () => Promise<void>;
}

const RemindersContext = createContext<RemindersValue | null>(null);

/** Supplies one application-layer owner for all passive reminder RPC state. */
export function RemindersProvider({ children }: { children: ReactNode }) {
  const client = useMemo(() => createRemindersClient(), []);
  const controller = useMemo(() => new RemindersController(client), [client]);
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot
  );
  useEffect(() => () => controller.dispose(), [controller]);
  const actions = useMemo(
    () => ({
      requestFeature: () => controller.requestFeature(),
      requestGithubStar: () => controller.requestGithubStar(),
      markFeatureSeen: () => controller.markFeatureSeen(),
      dismissGithubStarForever: () => controller.dismissGithubStarForever(),
    }),
    [controller]
  );
  const value = useMemo(
    () => ({
      ...snapshot,
      ...actions,
    }),
    [actions, snapshot]
  );
  return (
    <RemindersContext.Provider value={value}>
      {children}
    </RemindersContext.Provider>
  );
}

export function useReminders(): RemindersValue {
  const value = useContext(RemindersContext);
  if (value === null) {
    throw new Error("useReminders must be used within RemindersProvider");
  }
  return value;
}
