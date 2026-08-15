import { describe, expect, test } from "bun:test";

import {
  closeAllTabsIfAllowed,
  closeOtherTabsIfAllowed,
  closeTabIfAllowed,
  refreshTabIfAllowed,
} from "./pane-mutation-actions";
import { RuntimeRunTracker } from "./runtime-run-tracker";
import type { AppTab } from "./use-thread-tabs";

const TABS: AppTab[] = [
  {
    id: "playground:a",
    paneId: "pane-a",
    playgroundId: "a",
    title: "A",
    runtimeId: "local",
    type: "playground",
  },
  {
    id: "playground:b",
    paneId: "pane-b",
    playgroundId: "b",
    title: "B",
    runtimeId: "local",
    type: "playground",
  },
];

describe("pane mutation production actions", () => {
  test("close, close others, close all, and refresh stop before their mutations", () => {
    const tracker = new RuntimeRunTracker();
    tracker.beginRun("pane-a", "local", "run-a");
    tracker.beginRun("pane-b", "local", "run-b");
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
    const tracker = new RuntimeRunTracker();
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
    expect(tracker.beginRun("pane-a", "local", "during-refresh")).toBe(
      false
    );
    expect(typeof reservation).toBe("object");
    if (!reservation || typeof reservation !== "object") return;
    reservation.release();
    expect(tracker.beginRun("pane-a", "local", "after-remount")).toBe(true);
  });
});
