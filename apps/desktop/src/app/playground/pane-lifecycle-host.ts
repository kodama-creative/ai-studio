export interface PaneLifecycleHost {
  isMutationReserved: (paneId: string) => boolean;
  subscribeToMutationChanges: (listener: () => void) => () => void;
  onPersistenceChange: (
    paneId: string,
    owner: object,
    busy: boolean
  ) => void;
  onRefreshSettled: (paneId: string) => void;
  onRunSettled: (paneId: string, runId: string) => void;
  onRunStart: (paneId: string, runId: string) => boolean;
}
