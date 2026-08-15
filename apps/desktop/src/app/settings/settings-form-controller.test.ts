import { describe, expect, test } from "bun:test";

import { SettingsFormController } from "./settings-form-controller";

interface Value {
  readonly enabled: boolean;
  readonly text: string;
}

const INITIAL: Value = { enabled: false, text: "" };

describe("SettingsFormController", () => {
  test("loads settings and auxiliary context through one restartable lifecycle", async () => {
    const settings = _deferred<Value>();
    const context = _deferred<string | null>();
    const controller = _controller({
      loadSettings: () => settings.promise,
      loadContext: () => context.promise,
      initialContext: null,
    });

    controller.start();
    context.resolve("system-proxy");
    settings.resolve({ enabled: true, text: "loaded" });
    await _eventually(() => controller.getSnapshot().loading, false);

    expect(controller.getSnapshot()).toEqual({
      settings: { enabled: true, text: "loaded" },
      context: "system-proxy",
      loading: false,
    });
    controller.stop();
  });

  test("serializes optimistic commits and publishes only the latest result", async () => {
    const first = _deferred<Value>();
    const second = _deferred<Value>();
    const calls: Value[] = [];
    const controller = _controller({
      saveSettings: (value) => {
        calls.push(value);
        return calls.length === 1 ? first.promise : second.promise;
      },
    });
    controller.start();
    await _eventually(() => controller.getSnapshot().loading, false);

    const enable = controller.commit({ enabled: true, text: "first" });
    const disable = controller.commit({ enabled: false, text: "second" });
    await _eventually(() => calls.length, 1);
    expect(controller.getSnapshot().settings.text).toBe("second");

    first.resolve({ enabled: true, text: "first-normalized" });
    await _eventually(() => calls.length, 2);
    expect(controller.getSnapshot().settings.text).toBe("second");
    second.resolve({ enabled: false, text: "second-normalized" });
    await Promise.all([enable, disable]);
    expect(controller.getSnapshot().settings.text).toBe("second-normalized");
    controller.stop();
  });

  test("rolls back a failed latest commit but preserves a failed Draft save", async () => {
    const errors: string[] = [];
    let rejectSave = false;
    const controller = _controller({
      notifySaveError: (error) => errors.push(String(error)),
      saveSettings: (value) =>
        rejectSave
          ? Promise.reject(new Error("save failed"))
          : Promise.resolve(value),
    });
    controller.start();
    await _eventually(() => controller.getSnapshot().loading, false);
    await controller.commit({ enabled: true, text: "committed" });

    rejectSave = true;
    await controller.commit({ enabled: false, text: "toggle" });
    expect(controller.getSnapshot().settings).toEqual({
      enabled: true,
      text: "committed",
    });

    controller.update({ enabled: true, text: "unsaved key" });
    await controller.save();
    expect(controller.getSnapshot().settings.text).toBe("unsaved key");
    expect(errors).toHaveLength(2);
    controller.stop();
  });

  test("ignores late reads and skips old queued writes after stop", async () => {
    const load = _deferred<Value>();
    const firstSave = _deferred<Value>();
    let calls = 0;
    const controller = _controller({
      loadSettings: () => load.promise,
      saveSettings: (value) => {
        calls += 1;
        return calls === 1 ? firstSave.promise : Promise.resolve(value);
      },
    });

    controller.start();
    controller.stop();
    load.resolve({ enabled: true, text: "late" });
    await _flushMicrotasks();
    expect(controller.getSnapshot().settings).toEqual(INITIAL);

    controller.start();
    await _flushMicrotasks();
    load.resolve(INITIAL);
    await _eventually(() => controller.getSnapshot().loading, false);
    const first = controller.commit({ enabled: true, text: "first" });
    const queued = controller.commit({ enabled: false, text: "queued" });
    await _eventually(() => calls, 1);
    controller.stop();
    firstSave.resolve({ enabled: true, text: "first" });
    await Promise.all([first, queued]);
    expect(calls).toBe(1);
  });
});

function _controller<TContext = undefined>(
  overrides: Partial<{
    initialContext: TContext;
    loadContext: () => Promise<TContext>;
    loadSettings: () => Promise<Value>;
    saveSettings: (value: Value) => Promise<Value>;
    notifySaveError: (error: unknown) => void;
  }> = {}
): SettingsFormController<Value, TContext> {
  return new SettingsFormController<Value, TContext>({
    initialSettings: INITIAL,
    initialContext: overrides.initialContext as TContext,
    loadSettings: overrides.loadSettings ?? (() => Promise.resolve(INITIAL)),
    saveSettings:
      overrides.saveSettings ?? ((value) => Promise.resolve(value)),
    loadContext: overrides.loadContext,
    notifySaveError: overrides.notifySaveError ?? (() => undefined),
  });
}

function _deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, reject, resolve };
}

async function _eventually<T>(read: () => T, expected: T): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (read() === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  expect(read()).toBe(expected);
}

async function _flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
}
