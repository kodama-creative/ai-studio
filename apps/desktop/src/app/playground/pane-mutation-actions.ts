import type { PaneActivityTracker } from "./pane-activity-tracker";

export interface PaneTab {
  readonly id: string;
  readonly paneId: string;
}

export function paneIdForTab(tab: PaneTab): string {
  return tab.paneId;
}

function _runIfIdle({
  tracker,
  tabs,
  onBlocked,
  action,
}: {
  tracker: PaneActivityTracker;
  tabs: readonly PaneTab[];
  onBlocked: () => void;
  action: () => void;
}): boolean {
  if (tabs.some((tab) => tracker.isMutationReserved(paneIdForTab(tab)))) {
    onBlocked();
    return false;
  }
  const release = tracker.reservePanes(tabs.map(paneIdForTab));
  if (!release) {
    onBlocked();
    return false;
  }
  try {
    action();
    return true;
  } finally {
    release();
  }
}

export function closeTabIfAllowed({
  tracker,
  tabs,
  targetId,
  onBlocked,
  close,
}: {
  tracker: PaneActivityTracker;
  tabs: readonly PaneTab[];
  targetId: string;
  onBlocked: () => void;
  close: (id: string) => void;
}): boolean {
  const target = tabs.find((tab) => tab.id === targetId);
  if (!target) return false;
  return _runIfIdle({
    tracker,
    tabs: [target],
    onBlocked,
    action: () => close(target.id),
  });
}

export function closeOtherTabsIfAllowed({
  tracker,
  tabs,
  keepId,
  onBlocked,
  closeOthers,
}: {
  tracker: PaneActivityTracker;
  tabs: readonly PaneTab[];
  keepId: string;
  onBlocked: () => void;
  closeOthers: (id: string) => void;
}): boolean {
  const removed = tabs.filter((tab) => tab.id !== keepId);
  return _runIfIdle({
    tracker,
    tabs: removed,
    onBlocked,
    action: () => closeOthers(keepId),
  });
}

export function closeAllTabsIfAllowed({
  tracker,
  tabs,
  onBlocked,
  closeAll,
}: {
  tracker: PaneActivityTracker;
  tabs: readonly PaneTab[];
  onBlocked: () => void;
  closeAll: () => void;
}): boolean {
  return _runIfIdle({ tracker, tabs, onBlocked, action: closeAll });
}

export interface PaneRefreshReservation {
  paneId: string;
  release: () => void;
}

export function refreshTabIfAllowed({
  tracker,
  tabs,
  targetId,
  onBlocked,
  refresh,
}: {
  tracker: PaneActivityTracker;
  tabs: readonly PaneTab[];
  targetId: string;
  onBlocked: () => void;
  refresh: (id: string) => void;
}): PaneRefreshReservation | null {
  const target = tabs.find((tab) => tab.id === targetId);
  if (!target) return null;
  if (tracker.isMutationReserved(paneIdForTab(target))) {
    onBlocked();
    return null;
  }
  const paneId = paneIdForTab(target);
  const release = tracker.reservePanes([paneId]);
  if (!release) {
    onBlocked();
    return null;
  }
  try {
    refresh(target.id);
    return { paneId, release };
  } catch (error) {
    release();
    throw error;
  }
}
