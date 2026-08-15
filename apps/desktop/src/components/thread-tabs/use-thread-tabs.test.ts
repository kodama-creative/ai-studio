import { expect, test } from "bun:test";

import { pruneInvalidRestoredTabs } from "./restored-tab-pruning";
import type { AppTab } from "./use-thread-tabs";

test("restoration pruning preserves busy and subsequently opened pane owners", () => {
  const busy: AppTab = {
    id: "playground:busy",
    paneId: "busy-pane",
    playgroundId: "busy",
    title: "Busy",
    runtimeId: "local",
    type: "playground",
  };
  const idle: AppTab = {
    id: "playground:idle",
    paneId: "idle-pane",
    playgroundId: "idle",
    title: "Idle",
    runtimeId: "local",
    type: "playground",
  };
  const added: AppTab = {
    id: "playground:added",
    paneId: "added-pane",
    playgroundId: "added",
    title: "Added",
    runtimeId: "local",
    type: "playground",
  };

  expect(
    pruneInvalidRestoredTabs(
      [busy, idle, added],
      [busy, idle],
      (tab) => tab.paneId !== "busy-pane"
    )
  ).toEqual([busy, added]);

  const reopened = { ...idle, paneId: "reopened-pane" };
  expect(
    pruneInvalidRestoredTabs([reopened], [idle], () => true)
  ).toEqual([reopened]);
});
