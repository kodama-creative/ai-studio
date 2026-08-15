import type {
  PanePersistenceChange,
  PaneRunSettled,
  PaneRunStart,
} from "./pane-activity-tracker";

export interface PaneLifecycleHost {
  isMutationReserved: (paneId: string) => boolean;
  subscribeToMutationChanges: (listener: () => void) => () => void;
  onPersistenceChange: PanePersistenceChange;
  onRefreshSettled: (paneId: string) => void;
  onRunSettled: PaneRunSettled;
  onRunStart: PaneRunStart;
}
