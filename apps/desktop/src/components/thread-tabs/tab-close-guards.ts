import { electrobun } from "@/lib/electrobun";

type TabCloseGuard = () => Promise<boolean>;

const CLOSE_GUARDS = new Map<string, TabCloseGuard>();
const DIRTY_TABS = new Set<string>();
let beforeUnloadInstalled = false;

function _installBeforeUnloadGuard(): void {
  if (beforeUnloadInstalled || typeof window === "undefined") { return; }
  beforeUnloadInstalled = true;
  window.addEventListener("beforeunload", event => {
    if (DIRTY_TABS.size === 0) { return; }
    event.preventDefault();
    // Required by older embedded Chromium versions to trigger beforeunload.
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    event.returnValue = "";
  });
}

function _notifyDirtyState(): void {
  electrobun.rpc?.send.agentSourceDirtyStateChanged({
    dirty: DIRTY_TABS.size > 0
  });
}

export function registerTabCloseGuard(
  tabId: string,
  guard: TabCloseGuard
): () => void {
  CLOSE_GUARDS.set(tabId, guard);
  return () => {
    if (CLOSE_GUARDS.get(tabId) === guard) { CLOSE_GUARDS.delete(tabId); }
    if (DIRTY_TABS.delete(tabId)) { _notifyDirtyState(); }
  };
}

export function setTabDirty(tabId: string, dirty: boolean): void {
  _installBeforeUnloadGuard();
  if (dirty) { DIRTY_TABS.add(tabId); } else { DIRTY_TABS.delete(tabId); }
  _notifyDirtyState();
}

export async function canCloseTabs(
  tabIds: readonly string[]
): Promise<boolean> {
  for (const tabId of tabIds) {
    const guard = CLOSE_GUARDS.get(tabId);
    if (guard && !(await guard())) { return false; }
  }
  return true;
}
