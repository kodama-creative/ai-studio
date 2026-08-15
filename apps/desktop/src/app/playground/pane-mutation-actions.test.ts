import { describe, expect, test } from "bun:test";

import { PaneActivityTracker } from "./pane-activity-tracker";
import {
  closeAllTabsIfAllowed,
  closeOtherTabsIfAllowed,
  closeTabIfAllowed,
  refreshTabIfAllowed,
  type PaneTab,
} from "./pane-mutation-actions";

const TABS: PaneTab[] = [
  { id: "playground:a", paneId: "pane-a" },
  { id: "playground:b", paneId: "pane-b" },
];

describe("pane mutation production actions", () => {
  test("close, close others, close all, and refresh stop before their mutations", () => {
    const tracker = new PaneActivityTracker();
    tracker.beginRun("pane-a", "run-a");
    tracker.beginRun("pane-b", "run-b");
    let mutations = 0;
    let blocked = 0;
    const onBlocked = () => {
      blocked += 1;
    };

    expect(
      closeTabIfAllowed({
        tracker,
        tabs: TABS,
        targetId: TABS[0].id,
        onBlocked,
        close: () => {
          mutations += 1;
        },
      })
    ).toBe(false);
    expect(
      closeOtherTabsIfAllowed({
        tracker,
        tabs: TABS,
        keepId: TABS[0].id,
        onBlocked,
        closeOthers: () => {
          mutations += 1;
        },
      })
    ).toBe(false);
    expect(
      closeAllTabsIfAllowed({
        tracker,
        tabs: TABS,
        onBlocked,
        closeAll: () => {
          mutations += 1;
        },
      })
    ).toBe(false);
    expect(
      refreshTabIfAllowed({
        tracker,
        tabs: TABS,
        targetId: TABS[0].id,
        onBlocked,
        refresh: () => {
          mutations += 1;
        },
      })
    ).toBeNull();
    expect({ blocked, mutations }).toEqual({ blocked: 4, mutations: 0 });
  });

  test("refresh keeps its pane reserved until the remount acknowledges it", () => {
    const tracker = new PaneActivityTracker();
    let refreshCalls = 0;

    const reservation = refreshTabIfAllowed({
      tracker,
      tabs: TABS,
      targetId: TABS[0].id,
      onBlocked: () => undefined,
      refresh: () => {
        refreshCalls += 1;
      },
    });

    expect(refreshCalls).toBe(1);
    expect(tracker.beginRun("pane-a", "during-refresh")).toBe(false);
    expect(typeof reservation).toBe("object");
    if (!reservation || typeof reservation !== "object") return;
    reservation.release();
    expect(tracker.beginRun("pane-a", "after-remount")).toBe(true);
  });
});
