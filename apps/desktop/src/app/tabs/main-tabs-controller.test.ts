import { describe, expect, test } from "bun:test";

import {
  MainTabsController,
  type AppTab,
  type MainTabsActivity,
  type MainTabsPersistence,
  type MainTabsStoredState,
} from "./main-tabs-controller";

describe("MainTabsController", () => {
  test("restores a deduplicated snapshot with a valid active identity", () => {
    const persistence = new MemoryTabsPersistence({
      tabs: [
        _stored("alpha", "Alpha"),
        _stored("alpha", "Duplicate"),
        _stored("beta", "Beta"),
      ],
      activeId: "playground:missing",
    });

    const controller = _controller({ persistence });

    expect(
      controller.getSnapshot().tabs.map((tab) => [tab.playgroundId, tab.title])
    ).toEqual([
      ["alpha", "Alpha"],
      ["beta", "Beta"],
    ]);
    expect(controller.getSnapshot().activeId).toBe("playground:alpha");
  });

  test("validates exact restored owners and preserves busy or reopened panes", async () => {
    const exists = _deferred<boolean>();
    let canPruneBusy = false;
    let pruneChecks = 0;
    let notifyPruneChange: () => void = () => undefined;
    const persistence = new MemoryTabsPersistence({
      tabs: [_stored("busy", "Busy"), _stored("reopened", "Old")],
      activeId: "playground:reopened",
    });
    const controller = _controller({
      persistence,
      playgroundExists: () => exists.promise,
      canPruneRestoredTab: (tab) => {
        pruneChecks += 1;
        return tab.playgroundId !== "busy" || canPruneBusy;
      },
      subscribeToPruneChanges: (listener) => {
        notifyPruneChange = listener;
        return () => undefined;
      },
    });
    controller.start();
    const oldReopened = controller.getSnapshot().tabs[1];
    if (oldReopened === undefined) throw new Error("missing restored tab");

    controller.dispatch({ type: "close", id: oldReopened.id });
    controller.dispatch({
      type: "open",
      playgroundId: "reopened",
      title: "New",
    });
    exists.resolve(false);
    await _eventually(() => pruneChecks > 0, true);

    const tabs = controller.getSnapshot().tabs;
    expect(tabs.map((tab) => tab.playgroundId)).toEqual(["busy", "reopened"]);
    expect(tabs[1]).not.toBe(oldReopened);
    expect(tabs[1]?.title).toBe("New");

    controller.dispatch({
      type: "renamePlayground",
      playgroundId: "busy",
      title: "Busy renamed",
    });
    controller.dispatch({ type: "refresh", id: "playground:busy" });
    canPruneBusy = true;
    notifyPruneChange();
    expect(controller.getSnapshot().tabs.map((tab) => tab.playgroundId)).toEqual([
      "reopened",
    ]);
  });

  test("applies tab intents while preserving active and persisted state", () => {
    const persistence = new MemoryTabsPersistence();
    const controller = _controller({ persistence });

    controller.dispatch({ type: "open", playgroundId: "alpha", title: "A" });
    controller.dispatch({ type: "open", playgroundId: "beta", title: "B" });
    controller.dispatch({ type: "activate", id: "playground:missing" });
    expect(controller.getSnapshot().activeId).toBe("playground:beta");

    controller.dispatch({ type: "activateSibling", offset: 1 });
    expect(controller.getSnapshot().activeId).toBe("playground:alpha");
    controller.dispatch({ type: "reorder", from: 0, to: 1 });
    controller.dispatch({ type: "refresh", id: "playground:alpha" });
    controller.dispatch({
      type: "renamePlayground",
      playgroundId: "alpha",
      title: "Alpha renamed",
    });

    expect(controller.getSnapshot().tabs.map((tab) => tab.playgroundId)).toEqual([
      "beta",
      "alpha",
    ]);
    expect(controller.getSnapshot().tabs[1]).toMatchObject({
      title: "Alpha renamed",
      refreshNonce: 1,
    });
    expect(persistence.current).toEqual({
      tabs: [_stored("beta", "B"), _stored("alpha", "Alpha renamed")],
      activeId: "playground:alpha",
    });
  });

  test("does not resurrect a reopen superseded by a newer close", async () => {
    const firstAlphaCheck = _deferred<boolean>();
    let alphaChecks = 0;
    const controller = _controller({
      playgroundExists: (id) => {
        if (id !== "alpha") return Promise.resolve(true);
        alphaChecks += 1;
        return alphaChecks === 1
          ? firstAlphaCheck.promise
          : Promise.resolve(true);
      },
    });
    controller.start();
    controller.dispatch({ type: "open", playgroundId: "alpha", title: "A" });
    controller.dispatch({ type: "close", id: "playground:alpha" });
    controller.dispatch({ type: "reopenClosed" });
    await Promise.resolve();

    controller.dispatch({ type: "open", playgroundId: "beta", title: "B" });
    controller.dispatch({ type: "closeAll" });
    firstAlphaCheck.resolve(true);
    await firstAlphaCheck.promise;
    await Promise.resolve();
    expect(controller.getSnapshot().tabs).toEqual([]);

    controller.dispatch({ type: "reopenClosed" });
    await _eventually(
      () => controller.getSnapshot().tabs[0]?.playgroundId,
      "beta"
    );
    controller.dispatch({ type: "reopenClosed" });
    await _eventually(
      () => controller.getSnapshot().tabs.at(-1)?.playgroundId,
      "alpha"
    );
    expect(controller.getSnapshot().activeId).toBe("playground:alpha");
  });

  test("does not steal a newer explicit activation when reopen completes", async () => {
    const exists = _deferred<boolean>();
    const controller = _controller({ playgroundExists: () => exists.promise });
    controller.start();
    controller.dispatch({ type: "open", playgroundId: "alpha", title: "A" });
    controller.dispatch({ type: "open", playgroundId: "beta", title: "B" });
    controller.dispatch({ type: "close", id: "playground:beta" });
    controller.dispatch({ type: "reopenClosed" });
    await Promise.resolve();

    controller.dispatch({ type: "activate", id: "playground:alpha" });
    exists.resolve(true);
    await _eventually(() => controller.getSnapshot().tabs.length, 2);

    expect(controller.getSnapshot().activeId).toBe("playground:alpha");
  });

  test("a stopped reopen does not block work in the next lifecycle", async () => {
    const alphaExists = _deferred<boolean>();
    const controller = _controller({
      playgroundExists: (id) =>
        id === "alpha" ? alphaExists.promise : Promise.resolve(true),
    });
    controller.start();
    controller.dispatch({ type: "open", playgroundId: "alpha", title: "A" });
    controller.dispatch({ type: "closeAll" });
    controller.dispatch({ type: "reopenClosed" });
    await Promise.resolve();

    controller.stop();
    controller.start();
    controller.dispatch({ type: "open", playgroundId: "beta", title: "B" });
    controller.dispatch({ type: "closeAll" });
    controller.dispatch({ type: "reopenClosed" });
    await _eventually(
      () => controller.getSnapshot().tabs[0]?.playgroundId,
      "beta"
    );

    alphaExists.resolve(true);
    await alphaExists.promise;
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    controller.dispatch({ type: "reopenClosed" });
    await _eventually(
      () => controller.getSnapshot().tabs.at(-1)?.playgroundId,
      "alpha"
    );
  });

  test("ignores restoration results completed after stop", async () => {
    const exists = _deferred<boolean>();
    const controller = _controller({
      persistence: new MemoryTabsPersistence({
        tabs: [_stored("alpha", "Alpha")],
        activeId: "playground:alpha",
      }),
      playgroundExists: () => exists.promise,
    });

    controller.start();
    controller.stop();
    exists.resolve(false);
    await exists.promise;
    await Promise.resolve();

    expect(controller.getSnapshot().tabs).toHaveLength(1);
  });

  test("preserves closed tabs across transient existence failures", async () => {
    let checks = 0;
    const controller = _controller({
      playgroundExists: () => {
        checks += 1;
        return checks === 1
          ? Promise.reject(new Error("RPC unavailable"))
          : Promise.resolve(true);
      },
    });
    controller.start();
    controller.dispatch({ type: "open", playgroundId: "alpha", title: "A" });
    controller.dispatch({ type: "closeAll" });
    controller.dispatch({ type: "reopenClosed" });

    await _eventually(() => checks, 1);
    await Promise.resolve();
    expect(controller.getSnapshot().tabs).toEqual([]);
    expect(controller.getSnapshot().activeId).toBeNull();

    controller.dispatch({ type: "reopenClosed" });
    await _eventually(() => checks, 2);
    await _eventually(
      () => controller.getSnapshot().tabs[0]?.playgroundId,
      "alpha"
    );
  });

  test("contains persistence failures without hiding live state", () => {
    const persistence = new ThrowingTabsPersistence();
    const controller = _controller({ persistence });
    let notifications = 0;
    controller.subscribe(() => {
      notifications += 1;
    });

    controller.dispatch({ type: "open", playgroundId: "alpha", title: "A" });

    expect(controller.getSnapshot().tabs[0]?.playgroundId).toBe("alpha");
    expect(notifications).toBe(1);
  });

  test("failed activity subscription leaves start retryable", () => {
    let shouldThrow = true;
    const controller = _controller({
      subscribeToPruneChanges: () => {
        if (shouldThrow) throw new Error("subscription failed");
        return () => undefined;
      },
    });

    expect(() => controller.start()).toThrow("subscription failed");
    shouldThrow = false;
    expect(() => controller.start()).not.toThrow();
    controller.stop();
  });
});

class ThrowingTabsPersistence implements MainTabsPersistence {
  load(): MainTabsStoredState {
    throw new Error("storage unavailable");
  }

  save(): void {
    throw new Error("storage unavailable");
  }
}

class MemoryTabsPersistence implements MainTabsPersistence {
  current: MainTabsStoredState;

  constructor(
    initial: MainTabsStoredState = { tabs: [], activeId: null }
  ) {
    this.current = initial;
  }

  load(): MainTabsStoredState {
    return this.current;
  }

  save(state: MainTabsStoredState): void {
    this.current = structuredClone(state);
  }
}

function _controller(
  overrides: {
    persistence?: MainTabsPersistence;
    playgroundExists?: (playgroundId: string) => Promise<boolean>;
    canPruneRestoredTab?: (tab: AppTab) => boolean;
    subscribeToPruneChanges?: (listener: () => void) => () => void;
  } = {}
): MainTabsController {
  const playgroundExists =
    overrides.playgroundExists ?? (() => Promise.resolve(true));
  const activity: MainTabsActivity = {
    canPruneRestoredTab: overrides.canPruneRestoredTab ?? (() => true),
    subscribe:
      overrides.subscribeToPruneChanges ?? (() => () => undefined),
  };
  return new MainTabsController(
    overrides.persistence ?? new MemoryTabsPersistence(),
    {
      load: (playgroundId) =>
        playgroundExists(playgroundId).then((exists) =>
          exists ? ({} as never) : undefined
        ),
    },
    activity
  );
}

function _stored(playgroundId: string, title: string) {
  return { type: "playground" as const, playgroundId, title };
}

function _deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

async function _eventually<T>(read: () => T, expected: T): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (read() === expected) return;
    await Promise.resolve();
  }
  expect(read()).toBe(expected);
}
