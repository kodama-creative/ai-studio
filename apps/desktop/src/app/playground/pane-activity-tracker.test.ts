import { expect, test } from "bun:test";

import { PaneActivityTracker } from "./pane-activity-tracker";

test("pane activity subscriptions observe every busy-state transition", () => {
  const tracker = new PaneActivityTracker();
  const versions: number[] = [];
  tracker.subscribe(() => versions.push(tracker.getSnapshot()));
  const persistenceOwner = {};

  expect(tracker.beginRun("pane", "run")).toBe(true);
  expect(tracker.settleRun("pane", "run")).toBe(true);
  tracker.setPersistenceBusy("pane", persistenceOwner, true);
  tracker.setPersistenceBusy("pane", persistenceOwner, false);
  const release = tracker.reservePanes(["pane"]);
  expect(release).not.toBeNull();
  release?.();

  expect(versions).toEqual([1, 2, 3, 4, 5, 6]);
});
